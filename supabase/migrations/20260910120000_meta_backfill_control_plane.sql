-- =============================================================================
-- DATA V2.2.1 — Historical Backfill · CONTROL PLANE
-- Migration: 20260910120000_meta_backfill_control_plane
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (Supabase Studio > SQL Editor, ou
--     `supabase db push`). Idempotente (create table/index if not exists,
--     create or replace function/view, do $$ ... exception when duplicate_object).
--
-- ESCOPO DESTA MIGRATION — só o CONTROLE do backfill:
--   meta_backfill_jobs       — 1 processo histórico controlado (cliente+conta)
--   meta_backfill_segments   — 1 bloco de datas dentro de um job
--   claim_next_backfill_segment(...)      — aquisição atômica (FOR UPDATE SKIP LOCKED)
--   meta_backfill_release_stale_segments() — recupera segmento preso (lease morta)
--   meta_backfill_progress (view)          — telemetria derivada, sem contador duplicado
--
-- NÃO FAZ NESTA MIGRATION (fases seguintes):
--   NÃO cria planner (nenhuma linha de meta_backfill_segments é gerada aqui).
--   NÃO cria executor/Edge Function que chama a Meta.
--   NÃO cria Cron.
--   NÃO cria meta_rate_budget.
--   NÃO toca meta_sync_runs, meta_client_sync_health, meta_sync_acquire_client,
--       meta_clients_due_for_sync, meta_eligible_ad_accounts, meta_essential_stages,
--       Auto Sync ou Cron atual — NENHUMA linha abaixo os altera.
--
-- ISOLAMENTO DO CURRENT SYNC (achado da DATA V2.2A, docs/HISTORICAL-BACKFILL-PREFLIGHT.md):
--   meta_client_sync_health NÃO diferencia `trigger` — se o backfill escrevesse
--   em meta_sync_runs, contaminaria performance_synced_at/last_batch. Por isso
--   o backfill tem AUDITORIA PRÓPRIA (as duas tabelas desta migration) e NUNCA
--   grava em meta_sync_runs. A exclusividade com o Current Sync na MESMA conta
--   é feita por LEITURA (EXISTS, read-only) dentro de claim_next_backfill_segment.
--
--   ⚠️  ISTO É BEST-EFFORT, NÃO ATÔMICO (micro-auditoria pós-V2.2.1). O
--   NOT EXISTS lê meta_sync_runs sem nenhum lock compartilhado com
--   meta_sync_acquire_client — existe uma janela real (check-then-act) em que
--   os dois podem "adquirir" a mesma conta quase simultaneamente. Fechar isso
--   de verdade exigiria alterar TAMBÉM meta_sync_acquire_client (ex.: os dois
--   lados tomando o mesmo pg_advisory_xact_lock(hashtext(ad_account_ref::text))
--   antes de agir) — fora do escopo desta etapa (NÃO alterar Current Sync).
--   Por isso: NENHUM executor real deve ser ligado (DATA V2.2.2+) sem resolver
--   esta janela primeiro. Sem risco HOJE porque não há executor nenhum.
--
-- Reaproveita da fundação (20260901120000): can_access_client(uuid), is_agency(),
-- set_updated_at(). Reaproveita da META 1 (20260902130000): meta_lock_client_id(),
-- o enum public.meta_insight_level (account|campaign|adset|ad — mesmos 4 níveis,
-- sem tipo novo). Reaproveita da AUTO SYNC V1 (20260903193000) o padrão de
-- SECURITY DEFINER + search_path='' + revoke/grant + FOR UPDATE SKIP LOCKED-style
-- de aquisição atômica (meta_sync_acquire_client).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.meta_backfill_job_status as enum
    ('pending', 'running', 'paused', 'completed', 'exhausted', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meta_backfill_segment_status as enum
    ('pending', 'running', 'done', 'failed', 'skipped_no_data');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. meta_backfill_jobs — 1 processo histórico controlado (cliente + conta)
--
--    Campos DELIBERADAMENTE OMITIDOS por serem DERIVÁVEIS de meta_backfill_segments
--    (evita contador duplicado / fonte dupla de verdade — ver meta_backfill_progress):
--      oldest_date_fetched, newest_backfilled_date, segments_total/done/... .
--    `resolved_earliest_date` FICA (não é derivável — é um FATO observado da
--    Meta, preenchido pelo planner/executor de uma fase futura).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_backfill_jobs (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients (id) on delete cascade,
  ad_account_ref         uuid not null references public.meta_ad_accounts (id) on delete cascade,

  status                 public.meta_backfill_job_status not null default 'pending',

  -- escopo pretendido do job. requested_levels reaproveita o enum de nível já
  -- usado em meta_insights_daily/periodic — não cria tipo paralelo.
  requested_levels       public.meta_insight_level[] not null,
  target_start_date      date,        -- alvo pretendido; NULL = "o mais antigo possível"
  target_end_date        date not null, -- normalmente = 1 dia antes do horizonte operacional

  -- FATO observado (não derivável), preenchido por uma fase futura (planner).
  resolved_earliest_date date,

  priority               integer not null default 100, -- MENOR = mais prioritário (convenção: 0 = topo)

  paused_at              timestamptz, -- carimbo do ÚLTIMO pause (não é limpo ao retomar)
  started_at             timestamptz, -- 1ª vez que saiu de pending
  finished_at            timestamptz, -- quando chegou a um estado terminal

  last_error_code        text,
  last_error_at          timestamptz,

  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint meta_backfill_jobs_target_range check (
    target_start_date is null or target_start_date <= target_end_date
  ),
  constraint meta_backfill_jobs_levels_not_empty check (
    requested_levels is not null and array_length(requested_levels, 1) > 0
  )
);

comment on table public.meta_backfill_jobs is
  'DATA V2.2.1 — 1 processo de backfill histórico por (cliente, conta). Auditoria '
  'PRÓPRIA, separada de meta_sync_runs (ver nota de isolamento no topo do arquivo). '
  'Sem planner/executor nesta fase — nenhuma linha é criada por código ainda.';
comment on column public.meta_backfill_jobs.priority is
  'Menor valor = mais prioritário. Convenção: 0 = topo. Sem uso nesta fase (sem executor).';
comment on column public.meta_backfill_jobs.resolved_earliest_date is
  'Fato observado da Meta (ex.: created_time da campanha mais antiga). Preenchido '
  'pelo planner (fase futura), NÃO por esta migration.';

create index if not exists meta_backfill_jobs_client_idx  on public.meta_backfill_jobs (client_id);
create index if not exists meta_backfill_jobs_account_idx on public.meta_backfill_jobs (ad_account_ref);
create index if not exists meta_backfill_jobs_status_idx  on public.meta_backfill_jobs (status);

-- Histórico de jobs é permitido (uma conta pode ter N jobs completed/exhausted/
-- failed/cancelled ao longo do tempo — reparo de gaps, extensão de histórico,
-- novo backfill após novas métricas...). O que NÃO pode coexistir são DOIS jobs
-- ATIVOS conflitantes para a MESMA conta. `pending`/`running`/`paused` contam
-- como ativo; os 4 terminais NÃO entram no índice -> não bloqueiam um job novo.
create unique index if not exists meta_backfill_jobs_one_active_per_account
  on public.meta_backfill_jobs (ad_account_ref)
  where status in ('pending', 'running', 'paused');

comment on index public.meta_backfill_jobs_one_active_per_account is
  'No máximo 1 job pending/running/paused por conta. Jobs terminais (completed/'
  'exhausted/failed/cancelled) ficam como histórico e NUNCA bloqueiam um job novo.';

-- -----------------------------------------------------------------------------
-- 2a. Integridade client_id <-> ad_account_ref (não existe padrão equivalente a
--     reaproveitar nas tabelas meta_* atuais — só meta_lock_client_id, que trava
--     REATRIBUIÇÃO, não a CONSISTÊNCIA inicial). Solução mínima: 1 trigger de
--     INSERT que confirma que a conta pertence ao cliente informado E está
--     LINKADA — não faz sentido nascer um job para conta desvinculada.
--
--     Isto cobre só a CRIAÇÃO. Se a conta for desvinculada DEPOIS que o job já
--     existe, esta trigger não roda de novo — quem barra nesse caso é
--     claim_next_backfill_segment (seção 4), que RECHECA is_linked a cada
--     tentativa de reivindicar um segmento. Nenhum job "trabalha" silenciosamente
--     numa conta que deixou de estar linkada.
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_check_account_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.meta_ad_accounts a
    where a.id = new.ad_account_ref
      and a.client_id = new.client_id
      and a.is_linked = true
  ) then
    raise exception 'meta_backfill: ad_account_ref precisa pertencer ao client_id informado E estar linkada';
  end if;
  return new;
end;
$$;

create or replace trigger meta_backfill_jobs_check_account_client
  before insert on public.meta_backfill_jobs
  for each row execute function public.meta_backfill_check_account_client();

-- client_id imutável (mesma trigger genérica das tabelas meta_* atuais).
create or replace trigger meta_backfill_jobs_lock_client
  before update on public.meta_backfill_jobs
  for each row execute function public.meta_lock_client_id();

-- ad_account_ref imutável (nenhuma trigger genérica existente cobre isto —
-- criada seguindo EXATAMENTE o mesmo estilo de meta_lock_client_id).
create or replace function public.meta_lock_ad_account_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ad_account_ref is distinct from old.ad_account_ref then
    raise exception 'ad_account_ref do job de backfill é imutável';
  end if;
  return new;
end;
$$;

create or replace trigger meta_backfill_jobs_lock_account
  before update on public.meta_backfill_jobs
  for each row execute function public.meta_lock_ad_account_ref();

-- -----------------------------------------------------------------------------
-- 2b. Máquina de estados do JOB — transições válidas, carimbos automáticos.
--
--   pending   -> running, cancelled
--   running   -> paused, completed, exhausted, failed, cancelled
--   paused    -> running, cancelled
--   completed / exhausted / failed / cancelled -> (terminais; retry = novo job)
--   X -> X (mesmo status) é sempre permitido (update que não muda status).
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_jobs_check_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_valid := case old.status
    when 'pending' then new.status in ('running', 'cancelled')
    when 'running' then new.status in ('paused', 'completed', 'exhausted', 'failed', 'cancelled')
    when 'paused'  then new.status in ('running', 'cancelled')
    else false -- completed/exhausted/failed/cancelled são terminais
  end;

  if not v_valid then
    raise exception 'meta_backfill_jobs: transição de status inválida % -> %', old.status, new.status;
  end if;

  if new.status = 'running' and old.status = 'pending' then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status = 'paused' then
    new.paused_at := now();
  end if;
  if new.status in ('completed', 'exhausted', 'failed', 'cancelled') then
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end;
$$;

create or replace trigger meta_backfill_jobs_check_transition
  before update on public.meta_backfill_jobs
  for each row execute function public.meta_backfill_jobs_check_transition();

create or replace trigger meta_backfill_jobs_set_updated_at
  before update on public.meta_backfill_jobs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. meta_backfill_segments — 1 job + 1 nível + 1 intervalo de datas
--
--    NENHUMA linha é criada por esta migration (planner é fase futura).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_backfill_segments (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.meta_backfill_jobs (id) on delete cascade,

  level            public.meta_insight_level not null,
  date_from        date not null,
  date_to          date not null,

  status           public.meta_backfill_segment_status not null default 'pending',

  attempt_count    integer not null default 0,
  last_attempt_at  timestamptz,
  last_error_code  text,
  next_retry_at    timestamptz, -- reservada p/ backoff da fase do executor; sem lógica aqui

  claimed_at       timestamptz,
  lease_expires_at timestamptz, -- recuperação de worker morto (ver seção 5)
  lease_token      uuid,        -- fencing: identifica a posse ATUAL (ver seção 4)

  rows_written     integer,
  pages_fetched    integer,

  started_at       timestamptz,
  finished_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint meta_backfill_segments_range check (date_from <= date_to),
  constraint meta_backfill_segments_natural_uq
    unique (job_id, level, date_from, date_to)
);

comment on table public.meta_backfill_segments is
  'DATA V2.2.1 — 1 bloco de datas de UM job de backfill. Idempotente por desenho: '
  'UNIQUE (job_id, level, date_from, date_to) impede segmento duplicado. Sem '
  'attribution_window na identidade — não é uma dimensão de planejamento do '
  'segmento (é escolhida pela resposta da Meta ao gravar em meta_insights_daily).';
comment on column public.meta_backfill_segments.next_retry_at is
  'Reservada para backoff (DATA V2.2.2/executor). Sem cálculo nesta migration.';
comment on column public.meta_backfill_segments.lease_expires_at is
  'Prazo da posse do worker que reivindicou o segmento (claim_next_backfill_segment). '
  'meta_backfill_release_stale_segments() libera segmentos com lease vencida.';
comment on column public.meta_backfill_segments.lease_token is
  'FENCING TOKEN — novo (gen_random_uuid()) a cada claim_next_backfill_segment. '
  'Um worker que perdeu a lease (recuperado por meta_backfill_release_stale_segments '
  'e reivindicado por outro worker) tem um token DIFERENTE do atual; uma futura RPC '
  '"finish segment" (DATA V2.2.2, ainda não existe) deve exigir o token de volta e '
  'fazer UPDATE ... WHERE id = ? AND lease_token = ? — se não bater, 0 linhas afetadas '
  '(silenciosamente seguro), nunca sobrescreve o trabalho do worker atual.';

create index if not exists meta_backfill_segments_job_idx
  on public.meta_backfill_segments (job_id);
create index if not exists meta_backfill_segments_status_idx
  on public.meta_backfill_segments (status);
-- claim SÓ trabalha com `pending` (ver seção 4 — failed->pending é retry,
-- decidido por um processo separado; claim nunca lê `failed` diretamente).
create index if not exists meta_backfill_segments_claim_idx
  on public.meta_backfill_segments (job_id, status)
  where status = 'pending';
create index if not exists meta_backfill_segments_lease_idx
  on public.meta_backfill_segments (lease_expires_at)
  where status = 'running' and lease_expires_at is not null;

-- identidade do segmento (job_id, level, date_from, date_to) é imutável —
-- 1 trigger cobrindo as 4 colunas (mais simples que 4 triggers separadas).
create or replace function public.meta_backfill_segments_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_id is distinct from old.job_id
     or new.level is distinct from old.level
     or new.date_from is distinct from old.date_from
     or new.date_to is distinct from old.date_to
  then
    raise exception 'meta_backfill_segments: identidade (job_id, level, date_from, date_to) é imutável';
  end if;
  return new;
end;
$$;

create or replace trigger meta_backfill_segments_lock_identity
  before update on public.meta_backfill_segments
  for each row execute function public.meta_backfill_segments_lock_identity();

-- -----------------------------------------------------------------------------
-- 3a. Máquina de estados do SEGMENTO.
--
--   pending -> running
--   running -> done, failed, skipped_no_data, pending (= lease expirada/recuperada,
--              NÃO é falha semântica — ver meta_backfill_release_stale_segments)
--   failed  -> pending (retry)
--   done / skipped_no_data -> (terminais)
--
--   attempt_count/last_attempt_at/claimed_at/started_at são carimbados AQUI ao
--   entrar em `running` vindo de `pending` (a ÚNICA origem — claim nunca lê
--   `failed` diretamente, ver seção 4) — única fonte da contagem de tentativas,
--   mesmo que o UPDATE não venha do RPC de claim.
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_segments_check_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_valid := case old.status
    when 'pending' then new.status in ('running')
    when 'running' then new.status in ('done', 'failed', 'skipped_no_data', 'pending')
    when 'failed'  then new.status in ('pending')
    else false -- done/skipped_no_data são terminais
  end;

  if not v_valid then
    raise exception 'meta_backfill_segments: transição de status inválida % -> %', old.status, new.status;
  end if;

  if new.status = 'running' and old.status = 'pending' then
    new.attempt_count   := old.attempt_count + 1;
    new.last_attempt_at := now();
    new.started_at      := coalesce(new.started_at, now());
    new.claimed_at       := now();
  end if;

  if new.status = 'pending' and old.status = 'running' then
    -- lease recuperada: libera a posse, NÃO conta como erro. lease_token é
    -- zerado -> um worker antigo (com o token velho) nunca mais "casa" numa
    -- futura RPC de finalização (fencing, ver comentário da coluna).
    new.claimed_at       := null;
    new.lease_expires_at := null;
    new.lease_token      := null;
  end if;

  if new.status in ('done', 'failed', 'skipped_no_data') then
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end;
$$;

create or replace trigger meta_backfill_segments_check_transition
  before update on public.meta_backfill_segments
  for each row execute function public.meta_backfill_segments_check_transition();

create or replace trigger meta_backfill_segments_set_updated_at
  before update on public.meta_backfill_segments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. claim_next_backfill_segment — aquisição ATÔMICA (FOR UPDATE SKIP LOCKED)
--
--    SEMÂNTICA (micro-auditoria pós-V2.2.1, ver comentário da função):
--      - SÓ reivindica segmentos `pending`. `failed -> pending` é uma decisão
--        de retry SEPARADA (processo futuro, opcionalmente informado por
--        next_retry_at) — claim nunca lê `failed` diretamente. Isso alinha
--        índice + RPC + trigger (antes desta correção, o índice/RPC incluíam
--        `failed`, mas a trigger só aceitava failed->pending — a combinação
--        failed->running teria sido REJEITADA em runtime).
--      - SÓ de conta ainda `is_linked = true` — se a conta foi desvinculada
--        DEPOIS que o job foi criado, claim para de entregar segmentos dela
--        (nenhum trabalho silencioso numa conta desvinculada).
--      - Exclusividade com o Current Sync na MESMA conta: NOT EXISTS (SELECT
--        ... FROM meta_sync_runs WHERE status='running') — SÓ LEITURA, BEST
--        EFFORT (não atômico — ver nota no topo do arquivo). NUNCA insere/
--        atualiza meta_sync_runs.
--      - Gera um `lease_token` novo a cada claim (fencing) — ver comentário da
--        coluna `meta_backfill_segments.lease_token`.
--    p_job_id opcional -> permite reivindicar dentro de UM job só (útil para o
--    primeiro teste controlado, DATA V2.2A seção 29).
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
begin
  -- 1 statement atômico: a subquery reivindica a linha (FOR UPDATE SKIP LOCKED —
  -- dois workers concorrentes nunca escolhem o mesmo id) e o UPDATE externo já
  -- a transiciona para `running` na mesma operação.
  return query
  update public.meta_backfill_segments s
  set status = 'running',
      lease_expires_at = now() + p_lease,
      lease_token = pg_catalog.gen_random_uuid()
  from public.meta_backfill_jobs j
  where s.id = (
    select s2.id
    from public.meta_backfill_segments s2
    join public.meta_backfill_jobs j2 on j2.id = s2.job_id
    join public.meta_ad_accounts a2 on a2.id = j2.ad_account_ref
    where j2.status = 'running'
      and (p_job_id is null or j2.id = p_job_id)
      and s2.status = 'pending'
      and a2.is_linked = true
      and not exists (
        select 1 from public.meta_sync_runs r
        where r.ad_account_ref = j2.ad_account_ref
          and r.status = 'running'
      )
    order by j2.priority asc, s2.date_from desc, s2.created_at asc
    for update of s2 skip locked
    limit 1
  )
  and j.id = s.job_id
  returning s.id, s.job_id, j.client_id, j.ad_account_ref, s.level, s.date_from, s.date_to, s.attempt_count, s.lease_token;
end;
$$;

revoke all on function public.claim_next_backfill_segment(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.claim_next_backfill_segment(uuid, interval)
  to service_role;

comment on function public.claim_next_backfill_segment(uuid, interval) is
  'DATA V2.2.1 — aquisição atômica de 1 segmento `pending` elegível (FOR UPDATE '
  'SKIP LOCKED). NUNCA reivindica `failed` diretamente (retry é failed->pending '
  'por processo separado). Só de jobs `running` de conta ainda `is_linked`. '
  'Checa (read-only, BEST-EFFORT — não atômico) que a conta não tem sync '
  'operacional `running` no momento — nunca escreve em meta_sync_runs. Gera um '
  'lease_token novo por claim (fencing). Sem linha elegível -> devolve 0 linhas '
  '(não é erro).';

-- -----------------------------------------------------------------------------
-- 5. Recuperação de worker morto — sem Cron nesta fase (chamada manual/futura).
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_release_stale_segments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.meta_backfill_segments
  set status = 'pending'
  where status = 'running'
    and lease_expires_at is not null
    and lease_expires_at < now();
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.meta_backfill_release_stale_segments()
  from public, anon, authenticated;
grant execute on function public.meta_backfill_release_stale_segments()
  to service_role;

comment on function public.meta_backfill_release_stale_segments() is
  'DATA V2.2.1 — devolve a `pending` todo segmento `running` cuja lease expirou. '
  'NÃO é uma falha semântica (não conta como attempt extra na transição). Sem '
  'Cron nesta fase — chamada manual ou por uma fase futura.';

-- -----------------------------------------------------------------------------
-- 6. meta_backfill_progress — telemetria DERIVADA (nenhum contador duplicado)
--    security_invoker=true -> respeita a RLS das duas tabelas base.
-- -----------------------------------------------------------------------------
create or replace view public.meta_backfill_progress
with (security_invoker = true) as
select
  j.id                as job_id,
  j.client_id,
  j.ad_account_ref,
  j.status            as job_status,
  j.priority,
  count(s.id)                                                      as segments_total,
  count(s.id) filter (where s.status = 'pending')                  as segments_pending,
  count(s.id) filter (where s.status = 'running')                  as segments_running,
  count(s.id) filter (where s.status = 'done')                     as segments_done,
  count(s.id) filter (where s.status = 'failed')                   as segments_failed,
  count(s.id) filter (where s.status = 'skipped_no_data')          as segments_skipped,
  case
    when count(s.id) = 0 then null
    else round(
      100.0 * count(s.id) filter (where s.status in ('done', 'skipped_no_data'))
      / count(s.id), 2
    )
  end                 as progress_percent,
  min(s.date_from) filter (where s.status = 'done') as earliest_completed_date,
  max(s.date_to)   filter (where s.status = 'done') as latest_completed_date,
  j.resolved_earliest_date,
  j.target_start_date,
  j.target_end_date,
  j.last_error_code,
  j.last_error_at,
  j.started_at,
  j.paused_at,
  j.finished_at
from public.meta_backfill_jobs j
left join public.meta_backfill_segments s on s.job_id = j.id
group by
  j.id, j.client_id, j.ad_account_ref, j.status, j.priority,
  j.resolved_earliest_date, j.target_start_date, j.target_end_date,
  j.last_error_code, j.last_error_at, j.started_at, j.paused_at, j.finished_at;

revoke all on public.meta_backfill_progress from public, anon;
grant select on public.meta_backfill_progress to authenticated, service_role;

comment on view public.meta_backfill_progress is
  'DATA V2.2.1 — progresso de UM job de backfill, derivado de meta_backfill_segments '
  '(nenhum contador é duplicado no job). security_invoker=true -> só mostra jobs '
  'do(s) client_id(s) que o chamador pode acessar (can_access_client, via RLS das '
  'tabelas base).';

-- -----------------------------------------------------------------------------
-- 7. Privilégios — mesmo padrão das tabelas meta_* atuais.
--    anon: nada. authenticated: SÓ leitura. service_role: escreve via as RPCs
--    acima (SECURITY DEFINER) ou por bypass de RLS — NENHUMA policy de
--    INSERT/UPDATE/DELETE é criada para authenticated.
-- -----------------------------------------------------------------------------
revoke all on public.meta_backfill_jobs, public.meta_backfill_segments
  from anon, authenticated, public;

grant select on public.meta_backfill_jobs, public.meta_backfill_segments
  to authenticated;

revoke all on function public.meta_backfill_check_account_client() from anon, authenticated, public;
revoke all on function public.meta_lock_ad_account_ref() from anon, authenticated, public;
revoke all on function public.meta_backfill_jobs_check_transition() from anon, authenticated, public;
revoke all on function public.meta_backfill_segments_lock_identity() from anon, authenticated, public;
revoke all on function public.meta_backfill_segments_check_transition() from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
--    SELECT: quem pode acessar o cliente do job (mesmo padrão de
--    meta_sync_runs_select — can_access_client, sem exigir is_agency()).
--    Segments não têm client_id direto -> policy via EXISTS no job pai.
--    Nenhuma policy de INSERT/UPDATE/DELETE -> authenticated não escreve.
-- -----------------------------------------------------------------------------
alter table public.meta_backfill_jobs     enable row level security;
alter table public.meta_backfill_segments enable row level security;

drop policy if exists meta_backfill_jobs_select on public.meta_backfill_jobs;
create policy meta_backfill_jobs_select on public.meta_backfill_jobs
  for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists meta_backfill_segments_select on public.meta_backfill_segments;
create policy meta_backfill_segments_select on public.meta_backfill_segments
  for select to authenticated
  using (
    exists (
      select 1 from public.meta_backfill_jobs j
      where j.id = meta_backfill_segments.job_id
        and public.can_access_client(j.client_id)
    )
  );

-- =============================================================================
-- IDEMPOTÊNCIA
--   claim: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE no mesmo statement/txn —
--          dois workers concorrentes nunca reivindicam o mesmo segmento.
--   segmento duplicado: impedido por UNIQUE (job_id, level, date_from, date_to).
--   Rodar esta migration N vezes NÃO duplica tipos/tabelas/funções/policies
--   (create ... if not exists / or replace / drop policy if exists).
-- =============================================================================

-- =============================================================================
-- VALIDAÇÃO manual (rodar como dois client_user distintos, só depois de aplicar):
--   set role authenticated;  -- + jwt claims do usuário A
--   select * from public.meta_backfill_jobs;      -- só jobs de clients de A
--   select * from public.meta_backfill_progress;  -- idem
--   insert into public.meta_backfill_jobs (...) values (...); -- deve FALHAR (RLS)
--   reset role;
-- =============================================================================

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop policy if exists meta_backfill_segments_select on public.meta_backfill_segments;
--   drop policy if exists meta_backfill_jobs_select on public.meta_backfill_jobs;
--   drop view if exists public.meta_backfill_progress;
--   drop function if exists public.meta_backfill_release_stale_segments();
--   drop function if exists public.claim_next_backfill_segment(uuid, interval);
--   drop table if exists public.meta_backfill_segments cascade;
--   drop function if exists public.meta_lock_ad_account_ref() cascade;
--   drop function if exists public.meta_backfill_check_account_client() cascade;
--   drop table if exists public.meta_backfill_jobs cascade;
--   drop type if exists public.meta_backfill_segment_status;
--   drop type if exists public.meta_backfill_job_status;
-- =============================================================================
