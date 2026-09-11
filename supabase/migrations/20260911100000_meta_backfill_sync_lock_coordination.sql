-- =============================================================================
-- DATA V2.2.2 — Historical Backfill · COORDENAÇÃO ATÔMICA Current Sync × Backfill
-- Migration: 20260911100000_meta_backfill_sync_lock_coordination
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (Supabase Studio > SQL Editor, ou
--     `supabase db push`). Idempotente (create or replace function).
--
-- RESOLVE O BLOQUEADOR CRÍTICO documentado em 20260910120000 (V2.2.1): o
-- isolamento Current Sync × Backfill era BEST-EFFORT (check-then-act sem lock
-- compartilhado). Esta migration fecha a janela.
--
-- ARQUITETURA (auditada e validada explicitamente — não é só "usar advisory
-- lock" ingenuamente):
--
--   `pg_advisory_xact_lock` dura só a TRANSAÇÃO — soltar o lock não é o
--   suficiente por si só para impedir os dois trabalhos rodarem em paralelo
--   DEPOIS da aquisição. A exclusão real vem da COMBINAÇÃO:
--
--     1. mesma CHAVE de lock nos dois lados (namespace fixo + hash de
--        ad_account_ref) — meta_backfill_account_lock_key(uuid).
--     2. o lock protege só o MOMENTO da aquisição: check do estado persistido
--        do OUTRO lado + escrita do PRÓPRIO estado persistido, na MESMA
--        transação, enquanto o lock está seguro.
--     3. como as duas transações concorrentes na MESMA conta disputam a
--        MESMA chave, uma delas SEMPRE espera a outra COMMITAR antes de
--        prosseguir — e ao prosseguir, enxerga o estado JÁ COMMITADO do
--        primeiro (meta_sync_runs.status='running' OU
--        meta_backfill_segments.status='running'), e desiste.
--     4. depois que a transação vencedora comita, o lock passa a ser
--        irrelevante: o ESTADO PERSISTIDO (a linha running) é quem garante
--        que uma tentativa de aquisição FUTURA (de qualquer lado) vai se
--        recusar — não é o lock que protege a DURAÇÃO do trabalho, é a linha
--        `running` que cada lado já checa independentemente do lock.
--
--   Ou seja: o lock serializa só o INSTANTE da decisão "posso começar?"; o
--   estado que essa decisão grava é o que impede trabalho concorrente depois.
--
-- ORDEM DETERMINÍSTICA (evita deadlock): quando um cliente tem N contas
-- elegíveis, meta_sync_acquire_client toma os locks EM ORDEM (ad_account_ref)
-- — evita que duas chamadas concorrentes de meta_sync_acquire_client peguem
-- locks em ordens diferentes e se travem uma esperando a outra (deadlock
-- clássico). O backfill nunca segura mais de 1 lock por vez -> nunca pode
-- travar em espera circular com o outro lado.
--
-- MUDANÇA MÍNIMA em meta_sync_acquire_client (Current Sync): mesma
-- ASSINATURA, mesmo RETURNS TABLE, mesmo comportamento funcional (sync_batch_id
-- compartilhado, INSERT...SELECT atômico, sync_already_running,
-- no_eligible_account) — só ACRESCENTA o loop de lock+checagem ANTES do
-- INSERT existente. Reaproveita a MESMA string de exceção `sync_already_running`
-- para "backfill rodando nesta conta" -> sync-core.ts/tests NÃO precisam mudar
-- (o chamador já trata sync_already_running como skip esperado).
--
-- claim_next_backfill_segment ganha uma FASE 2 (lock + recheck de
-- meta_sync_runs E de outro segmento de backfill da MESMA conta) depois de
-- escolher o candidato — mesma assinatura de entrada, RETURNS TABLE
-- IDÊNTICO ao de 20260910120000 (lease_token incluso).
--
-- MICRO-AUDITORIA (segunda rodada, pré-Dev): MÁXIMO 1 SEGMENTO DE BACKFILL
-- running POR CONTA (decisão de produto — backfill é baixa prioridade,
-- reduz pressão de rate limit, simplifica recovery/telemetria; contas
-- DIFERENTES continuam independentes). Sem esta segunda checagem sob o
-- MESMO lock, dois workers de backfill concorrentes (cada um escolhendo um
-- segmento PENDING diferente na Fase 1) podiam, cada um a seu turno,
-- marcar SEU segmento como running -> 2 segmentos running simultâneos na
-- MESMA conta. Corrigido nesta versão (ver comentário no corpo da função).
-- Reforçado por um CHECK declarativo na tabela (seção 4): RUNNING exige
-- claimed_at/lease_token/lease_expires_at preenchidos; qualquer outro
-- status exige os 3 nulos — nenhum caminho (presente ou futuro) pode violar
-- o invariante sem falhar no próprio banco.
--
-- NÃO toca: sync-core.ts, normalizer, periodic, dailyHorizon, Auto Sync Cron,
-- meta_sync_release, meta_client_sync_health, Edge Functions, meta_rate_budget.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chave de lock compartilhada — ÚNICA fonte da derivação, usada pelos dois
--    lados. Namespace fixo (77771) evita colidir com qualquer outro uso futuro
--    de advisory lock no projeto.
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_account_lock_key(p_ad_account_ref uuid)
returns integer
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.hashtext(p_ad_account_ref::text);
$$;

comment on function public.meta_backfill_account_lock_key(uuid) is
  'DATA V2.2.2 — deriva a chave (int4) do advisory lock de coordenação '
  'Current Sync × Backfill para UMA conta. Usada com o namespace 77771 em '
  'pg_advisory_xact_lock(77771, meta_backfill_account_lock_key(id)) nos dois '
  'lados (meta_sync_acquire_client e claim_next_backfill_segment).';

revoke all on function public.meta_backfill_account_lock_key(uuid) from anon, authenticated, public;
grant execute on function public.meta_backfill_account_lock_key(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. meta_sync_acquire_client — ACRESCENTA a coordenação, preserva tudo mais.
-- -----------------------------------------------------------------------------
create or replace function public.meta_sync_acquire_client(
  p_client_id   uuid,
  p_trigger     public.meta_sync_trigger,
  p_date_from   date,
  p_date_to     date,
  p_created_by  uuid
)
returns table (
  ad_account_ref uuid,
  connection_id  uuid,
  run_id         uuid,
  sync_batch_id  uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid := pg_catalog.gen_random_uuid();  -- qualificado: search_path=''
  v_count integer;
  v_account record;
begin
  if p_client_id is null then
    raise exception 'p_client_id é obrigatório';
  end if;

  -- COORDENAÇÃO (DATA V2.2.2): 1 advisory lock POR CONTA elegível, em ordem
  -- determinística (ad_account_ref) para nunca deadlockar com outra chamada
  -- concorrente de meta_sync_acquire_client. Sob o lock de cada conta, checa
  -- se existe segmento de BACKFILL `running` nela -> se sim, é a MESMA
  -- condição de "conta ocupada" que já existe hoje -> mesma exceção
  -- `sync_already_running` (sync-core.ts já trata como skip esperado, sem
  -- precisar de nenhuma mudança). Locks são de escopo de TRANSAÇÃO — somem no
  -- commit/rollback deste bloco inteiro (não seguram além da aquisição).
  for v_account in
    select e.ad_account_ref
    from public.meta_eligible_ad_accounts e
    where e.client_id = p_client_id
    order by e.ad_account_ref
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      77771, public.meta_backfill_account_lock_key(v_account.ad_account_ref)
    );
    if exists (
      select 1
      from public.meta_backfill_segments s
      join public.meta_backfill_jobs j on j.id = s.job_id
      where j.ad_account_ref = v_account.ad_account_ref
        and s.status = 'running'
    ) then
      raise exception 'sync_already_running';
    end if;
  end loop;

  -- INSERT ... SELECT: um único statement -> atômico. Se QUALQUER conta já
  -- tiver run `running`, o índice único parcial
  -- meta_sync_runs (ad_account_ref) WHERE status='running' faz o statement
  -- inteiro falhar (unique_violation) e a transação reverte por completo —
  -- sem commit parcial. (Comportamento INALTERADO desde 20260903205700.)
  begin
    return query
    with ins as (
      insert into public.meta_sync_runs as msr (
        client_id, connection_id, ad_account_ref, trigger, status,
        date_from, date_to, created_by, sync_batch_id, started_at
      )
      select
        e.client_id, e.connection_id, e.ad_account_ref,
        coalesce(p_trigger, 'manual'), 'running',
        p_date_from, p_date_to, p_created_by, v_batch, now()
      from public.meta_eligible_ad_accounts e
      where e.client_id = p_client_id
      returning msr.ad_account_ref, msr.connection_id, msr.id
    )
    select i.ad_account_ref, i.connection_id, i.id, v_batch from ins i;
  exception when unique_violation then
    raise exception 'sync_already_running';
  end;

  get diagnostics v_count = row_count;
  if coalesce(v_count, 0) = 0 then
    raise exception 'no_eligible_account';
  end if;
end;
$$;

revoke all on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid)
  to service_role;

comment on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid) is
  'AUTO SYNC V1 — acquire ATÔMICO por cliente. Deriva as contas de '
  'meta_eligible_ad_accounts (não recebe connection_id). Um sync_batch_id '
  'compartilhado; cada run guarda a connection_id da própria conta. Qualquer '
  'conta em `running` (sync OU backfill) -> sync_already_running (rollback '
  'total). DATA V2.2.2: coordenação atômica com o Historical Backfill via '
  'pg_advisory_xact_lock por conta, ordem determinística. Mesma assinatura, '
  'mesmo comportamento funcional além da coordenação (fix 20260903205700 '
  'preservado).';

-- -----------------------------------------------------------------------------
-- 3. claim_next_backfill_segment — FASE 2: lock + recheck de meta_sync_runs
--    depois de escolher o candidato. Mesma assinatura e RETURNS TABLE de
--    20260910120000 (com lease_token).
-- -----------------------------------------------------------------------------
create or replace function public.claim_next_backfill_segment(
  p_job_id uuid default null,
  p_lease  interval default interval '10 minutes'
)
returns table (
  segment_id     uuid,
  job_id         uuid,
  client_id      uuid,
  ad_account_ref uuid,
  level          public.meta_insight_level,
  date_from      date,
  date_to        date,
  attempt_count  integer,
  lease_token    uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment_id  uuid;
  v_account_ref uuid;
begin
  -- MICRO-AUDITORIA (pré-Dev): p_lease precisa ser um intervalo POSITIVO —
  -- zero ou negativo produziria lease_expires_at <= now() já no momento do
  -- claim, tornando o segmento "expirado" antes mesmo de o worker começar.
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'claim_next_backfill_segment: p_lease precisa ser um intervalo positivo (recebido %)', p_lease;
  end if;

  -- FASE 1: escolhe 1 candidato — MESMOS critérios de 20260910120000 (job
  -- running, conta is_linked, segmento pending, FOR UPDATE SKIP LOCKED entre
  -- workers de backfill concorrentes). O row lock do segmento persiste até o
  -- fim desta função (commit/rollback), então nenhum outro worker de backfill
  -- pega o MESMO segmento enquanto decidimos a FASE 2.
  select s2.id, j2.ad_account_ref
  into v_segment_id, v_account_ref
  from public.meta_backfill_segments s2
  join public.meta_backfill_jobs j2 on j2.id = s2.job_id
  join public.meta_ad_accounts a2 on a2.id = j2.ad_account_ref
  where j2.status = 'running'
    and (p_job_id is null or j2.id = p_job_id)
    and s2.status = 'pending'
    and a2.is_linked = true
  order by j2.priority asc, s2.date_from desc, s2.created_at asc
  for update of s2 skip locked
  limit 1;

  if v_segment_id is null then
    return; -- nada elegível agora — não é erro
  end if;

  -- FASE 2 (DATA V2.2.2): MESMA chave/namespace de meta_sync_acquire_client.
  -- Bloqueia até qualquer aquisição concorrente do Current Sync NESTA conta
  -- terminar (commit ou rollback) — e então enxerga o estado JÁ COMMITADO.
  perform pg_catalog.pg_advisory_xact_lock(
    77771, public.meta_backfill_account_lock_key(v_account_ref)
  );
  if exists (
    select 1 from public.meta_sync_runs r
    where r.ad_account_ref = v_account_ref
      and r.status = 'running'
  ) then
    return; -- Current Sync está rodando nesta conta agora — não reivindica, não é erro
  end if;

  -- MICRO-AUDITORIA (pré-Dev): MÁXIMO 1 SEGMENTO DE BACKFILL running POR
  -- CONTA (decisão de produto/arquitetura desta fase — backfill é baixa
  -- prioridade, reduz pressão de rate limit, simplifica recovery e
  -- telemetria). AINDA sob o MESMO lock desta conta, checa se já existe
  -- OUTRO segmento de backfill `running` nela — se sim, desiste sem
  -- reivindicar (mesmo padrão do check de Current Sync acima). Filtra
  -- SÓ por status='running' (não por lease_expires_at): uma lease
  -- EXPIRADA continua bloqueando até meta_backfill_release_stale_segments()
  -- rodar de fato — não existe "ressuscitar" uma lease vencida por aqui.
  --
  -- SEM este check: dois workers concorrentes, cada um tendo escolhido um
  -- segmento PENDING diferente na Fase 1 (FOR UPDATE SKIP LOCKED só evita
  -- pegarem a MESMA linha, não impede linhas DIFERENTES da MESMA conta),
  -- cada um a seu turno sob o MESMO lock, conseguiam marcar SEU segmento
  -- como running -> 2 segmentos running simultâneos na MESMA conta. Com o
  -- check, o segundo a obter o lock enxerga o running já COMITADO do
  -- primeiro (MVCC) e desiste — mesmo protocolo (lock serializa o
  -- check-then-write; o estado persistido é o que qualquer aquisição
  -- FUTURA respeita) já usado para a exclusão com o Current Sync.
  if exists (
    select 1
    from public.meta_backfill_segments s3
    join public.meta_backfill_jobs j3 on j3.id = s3.job_id
    where j3.ad_account_ref = v_account_ref
      and s3.status = 'running'
  ) then
    return; -- já existe outro segmento de backfill running nesta conta — não reivindica, não é erro
  end if;

  return query
  update public.meta_backfill_segments s
  set status = 'running',
      lease_expires_at = now() + p_lease,
      lease_token = pg_catalog.gen_random_uuid()
  from public.meta_backfill_jobs j
  where s.id = v_segment_id
    and j.id = s.job_id
  returning s.id, s.job_id, j.client_id, j.ad_account_ref, s.level, s.date_from, s.date_to, s.attempt_count, s.lease_token;
end;
$$;

revoke all on function public.claim_next_backfill_segment(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.claim_next_backfill_segment(uuid, interval)
  to service_role;

comment on function public.claim_next_backfill_segment(uuid, interval) is
  'DATA V2.2.1/V2.2.2 — aquisição atômica de 1 segmento `pending` elegível '
  '(FOR UPDATE SKIP LOCKED entre workers de backfill). Nunca reivindica '
  '`failed` diretamente. Só de jobs `running` de conta ainda `is_linked`. '
  'DATA V2.2.2: coordenação atômica com o Current Sync via '
  'pg_advisory_xact_lock (mesma chave de meta_sync_acquire_client) + recheck '
  'de meta_sync_runs sob o lock — NÃO É MAIS best-effort. MÁXIMO 1 SEGMENTO '
  'DE BACKFILL running POR CONTA — recheca, sob o MESMO lock, se já existe '
  'outro segmento running na conta antes de reivindicar (contas diferentes '
  'continuam independentes). Gera um lease_token novo por claim (fencing). '
  'p_lease precisa ser positivo (validado; zero/negativo -> exception). Sem '
  'linha elegível -> devolve 0 linhas (não é erro).';

-- =============================================================================
-- POR QUE ISTO É REALMENTE ATÔMICO (não só "parece"):
--   Sejam T1 (meta_sync_acquire_client, conta X) e T2 (claim_next_backfill_segment,
--   mesma conta X) concorrentes.
--   - As duas disputam pg_advisory_xact_lock(77771, hash(X)).
--   - Postgres serializa: uma delas obtém o lock primeiro: a OUTRA fica
--     bloqueada em pg_advisory_xact_lock até a primeira COMMITAR ou ROLLBACK
--     (é assim que pg_advisory_xact_lock funciona — não há como as duas
--     "acharem" que têm o lock ao mesmo tempo).
--   - Quem for primeiro faz: checa o estado do OUTRO lado (ainda sob o lock,
--     na MESMA transação) -> não encontra nada -> escreve o PRÓPRIO estado
--     persistido (meta_sync_runs running OU meta_backfill_segments running)
--     -> COMMITA (o lock só é liberado no commit).
--   - Quem for segundo só prossegue DEPOIS desse commit -> ao checar o estado
--     do outro lado, VÊ a linha já commitada (visibilidade garantida por
--     MVCC/commit do Postgres) -> desiste (sync_already_running, ou `return`
--     sem reivindicar).
--   Não existe uma janela em que os dois passem no check simultaneamente,
--   porque o check e a escrita do PRÓPRIO estado acontecem DEPOIS de obter o
--   MESMO lock — o lock serializa exatamente o par (check, write) que
--   importa. Depois do commit, o lock deixa de ser necessário: o estado
--   persistido (a linha `running`) é o que qualquer tentativa FUTURA de
--   aquisição (de qualquer lado) vai encontrar e respeitar.
--
--   O MESMO raciocínio se aplica, sem nenhuma peça nova, a T2 (backfill,
--   segmento A) e T3 (backfill, segmento B) — WORKERS DIFERENTES na MESMA
--   conta X: os dois disputam pg_advisory_xact_lock(77771, hash(X)) (MESMA
--   chave, independente de qual segmento cada um escolheu na Fase 1). Quem
--   for primeiro marca SEU segmento running e comita; quem for segundo, ao
--   prosseguir, encontra esse running já commitado no NOVO check da seção 3
--   (`exists (... join meta_backfill_jobs ... where ad_account_ref = X and
--   status = 'running')`) e desiste — nunca marca o segundo segmento como
--   running. Contas diferentes (chaves de lock diferentes) nunca disputam
--   entre si -> permanecem paralelas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4. Invariante declarativo de consistência do ownership do segmento —
--    reforça em nível de BANCO (não só nas RPCs) a regra:
--      RUNNING          -> claimed_at, lease_token, lease_expires_at TODOS preenchidos.
--      qualquer outro   -> os 3 TODOS nulos.
--    Nenhuma linha pode existir num estado ambíguo (ex.: `pending` com um
--    lease_token de uma posse anterior) — nem por bug futuro em alguma RPC,
--    nem por UPDATE manual. Tabela está vazia nesta fase (sem
--    planner/executor rodando ainda) — sem dado existente para violar o
--    constraint na hora de aplicar.
-- -----------------------------------------------------------------------------
do $$ begin
  alter table public.meta_backfill_segments
    add constraint meta_backfill_segments_ownership_consistent
    check (
      (
        status = 'running'
        and claimed_at is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'running'
        and claimed_at is null
        and lease_token is null
        and lease_expires_at is null
      )
    );
exception when duplicate_object then null;
end $$;

comment on constraint meta_backfill_segments_ownership_consistent on public.meta_backfill_segments is
  'DATA V2.2.2 (micro-auditoria) — só `running` carrega posse (claimed_at + '
  'lease_token + lease_expires_at, todos preenchidos); qualquer outro status '
  '(pending/done/failed/skipped_no_data) exige os 3 nulos. Reforço '
  'declarativo do contrato que as RPCs (claim/complete/fail/retry/release) '
  'já mantêm — falha explícita se algum caminho o violar.';

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   alter table public.meta_backfill_segments
--     drop constraint if exists meta_backfill_segments_ownership_consistent;
--   -- recriar claim_next_backfill_segment na versão de 20260910120000
--   -- (sem a FASE 2 de lock, sem o check de outro segmento running);
--   -- recriar meta_sync_acquire_client na versão de 20260903205700
--   -- (sem o loop de lock);
--   drop function if exists public.meta_backfill_account_lock_key(uuid);
-- =============================================================================
