-- =============================================================================
-- AUTO SYNC V1 + CREATIVE SYNC INCREMENTAL
-- =============================================================================
-- Depende de META 1/5 (meta_sync_runs, meta_sync_acquire/release,
-- meta_ad_accounts.connection_id, meta_creatives, can_access_client).
--
-- Aditivo. NÃO cria tabela. NÃO faz backfill heurístico. O `cron.schedule`
-- fica COMENTADO (aplicar esta migration != ligar o cron).
--
-- Resumo:
--   1. extensões pg_cron / pg_net / supabase_vault
--   2. meta_sync_runs.sync_batch_id  (identidade da EXECUÇÃO do cliente)
--   3. meta_creatives.details_fetched_at  (chave do fetch incremental de FULL)
--   4. view meta_eligible_ad_accounts  (FONTE ÚNICA de elegibilidade de conta)
--   5. meta_sync_gc_stale(client)  (limpa runs presos, transação própria)
--   6. meta_sync_acquire_client(client, trigger, from, to, created_by)
--        -> 1 run por conta ELEGÍVEL, mesmo sync_batch_id, connection_id da
--           própria conta; ATÔMICO (INSERT ... SELECT: qualquer conta já
--           `running` -> aborta tudo, sync_already_running)
--   7. view meta_client_sync_health (security_invoker) — performance freshness
--        SEPARADA de last sync health SEPARADA de creatives health; agrega o
--        BATCH mais recente, não "a última conta que terminou"
--   8. meta_clients_due_for_sync(limit, min_age) — MESMA elegibilidade da (4),
--        decide por idade de performance_synced_at (não pelo status do run)
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- -----------------------------------------------------------------------------
-- 2. identidade da execução do cliente
-- -----------------------------------------------------------------------------
alter table public.meta_sync_runs
  add column if not exists sync_batch_id uuid;

create index if not exists meta_sync_runs_batch_idx
  on public.meta_sync_runs (sync_batch_id)
  where sync_batch_id is not null;

comment on column public.meta_sync_runs.sync_batch_id is
  'AUTO SYNC V1 — 1 valor por execução de meta_sync_acquire_client(); N runs '
  '(um por conta do cliente) compartilham o mesmo batch. Identidade explícita, '
  'não inferida por timestamp.';

-- -----------------------------------------------------------------------------
-- 3. chave do fetch INCREMENTAL de creatives (sem backfill)
-- -----------------------------------------------------------------------------
alter table public.meta_creatives
  add column if not exists details_fetched_at timestamptz;

create index if not exists meta_creatives_details_stale_idx
  on public.meta_creatives (details_fetched_at);

comment on column public.meta_creatives.details_fetched_at is
  'AUTO SYNC V1 — quando o GET FULL do AdCreative teve sucesso. NULL = novo ou '
  'salvo só via MINIMAL. O sync busca FULL quando NULL ou > 24h. SEM backfill '
  'heurístico: os creatives atuais ficam NULL e recebem 1 refresh FULL no '
  'primeiro sync pós-migration.';

-- -----------------------------------------------------------------------------
-- 4. FONTE ÚNICA de elegibilidade de conta
--    conta linkada + conexão existente e válida + credencial presente
--
--    security_invoker = true -> quando `authenticated` lê (via
--    meta_client_sync_health), a RLS de meta_ad_accounts/meta_connections
--    (can_access_client / is_agency) filtra para os clients permitidos.
--    Quando service_role lê (acquire/dispatcher), enxerga tudo (BYPASSRLS).
--
--    Usa `mc.has_secret` (coluna, legível por authenticated via RLS) — NÃO
--    toca meta_connection_secrets (deny-all p/ authenticated). A ausência real
--    do cipher já é tratada com segurança em runClientSync (`no_connection_secret`
--    -> run `error` + conexão marcada `reauthorization_required`).
-- -----------------------------------------------------------------------------
create or replace view public.meta_eligible_ad_accounts
with (security_invoker = true) as
  select
    a.id            as ad_account_ref,
    a.client_id     as client_id,
    a.connection_id as connection_id
  from public.meta_ad_accounts a
  join public.meta_connections mc on mc.id = a.connection_id
  where a.is_linked = true
    and a.connection_id is not null
    and mc.status in ('active', 'expiring')
    and mc.has_secret = true;

revoke all on public.meta_eligible_ad_accounts from public, anon;
grant select on public.meta_eligible_ad_accounts to authenticated, service_role;

comment on view public.meta_eligible_ad_accounts is
  'AUTO SYNC V1 — critério ÚNICO de conta sincronizável (linkada + conexão '
  'active/expiring + has_secret). security_invoker=true: authenticated só vê os '
  'clients permitidos (RLS); service_role vê tudo. NÃO lê meta_connection_secrets.';

-- -----------------------------------------------------------------------------
-- 5. limpeza de runs presos — transação própria
-- -----------------------------------------------------------------------------
create or replace function public.meta_sync_gc_stale(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.meta_sync_runs r
  set status = 'error',
      error_text = coalesce(r.error_text, 'stale: excedeu o tempo limite'),
      finished_at = now()
  where r.status = 'running'
    and r.started_at < now() - interval '20 minutes'
    and r.ad_account_ref in (
      select a.id from public.meta_ad_accounts a where a.client_id = p_client_id
    );
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.meta_sync_gc_stale(uuid) from public, anon, authenticated;
grant execute on function public.meta_sync_gc_stale(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 6. acquire ATÔMICO do cliente inteiro
--    (NÃO recebe connection_id: deriva por conta)
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
begin
  if p_client_id is null then
    raise exception 'p_client_id é obrigatório';
  end if;

  -- INSERT ... SELECT: um único statement -> atômico. Se QUALQUER conta já
  -- tiver run `running`, o índice único parcial
  -- meta_sync_runs (ad_account_ref) WHERE status='running' faz o statement
  -- inteiro falhar (unique_violation) e a transação reverte por completo —
  -- sem commit parcial.
  begin
    return query
    with ins as (
      insert into public.meta_sync_runs (
        client_id, connection_id, ad_account_ref, trigger, status,
        date_from, date_to, created_by, sync_batch_id, started_at
      )
      select
        e.client_id, e.connection_id, e.ad_account_ref,
        coalesce(p_trigger, 'manual'), 'running',
        p_date_from, p_date_to, p_created_by, v_batch, now()
      from public.meta_eligible_ad_accounts e
      where e.client_id = p_client_id
      returning ad_account_ref, connection_id, id
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
  'conta em `running` -> sync_already_running (rollback total).';

-- -----------------------------------------------------------------------------
-- 7. saúde de sincronização por CLIENTE — três eixos SEPARADOS
--    security_invoker = true -> respeita a RLS de meta_sync_runs
-- -----------------------------------------------------------------------------
-- stages essenciais de PERFORMANCE (creatives/ad_creatives NÃO entram)
create or replace function public.meta_essential_stages()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'campaigns','adsets','ads',
    'insights_daily_account','insights_daily_campaign','insights_daily_adset','insights_daily_ad',
    'insights_periodic_account','insights_periodic_campaign','insights_periodic_adset','insights_periodic_ad'
  ]::text[];
$$;

create or replace view public.meta_client_sync_health
with (security_invoker = true) as
with
-- por conta: quando a PERFORMANCE (stages essenciais todos done) ficou válida
perf_per_account as (
  select r.ad_account_ref,
         (select a.client_id from public.meta_ad_accounts a where a.id = r.ad_account_ref) as client_id,
         max(r.finished_at) filter (
           where r.finished_at is not null
             and (r.stats -> 'stages_done') ?& public.meta_essential_stages()
         ) as perf_at
  from public.meta_sync_runs r
  group by r.ad_account_ref
),
-- cliente: só é tão fresco quanto a conta ELEGÍVEL mais atrasada.
-- IMPORTANTE: min() ignora NULL. Se QUALQUER conta elegível não tem sync de
-- performance válido (conta sem run, ou sem run essencial-ok) -> o cliente é
-- `never`, NÃO o min das que sincronizaram.
perf_per_client as (
  select e.client_id,
         case
           when bool_or(p.perf_at is null) then null
           else min(p.perf_at)
         end as performance_synced_at
  from public.meta_eligible_ad_accounts e
  left join perf_per_account p on p.ad_account_ref = e.ad_account_ref
  group by e.client_id
),
-- runs com chave de EXECUÇÃO efetiva: runs novos usam sync_batch_id;
-- runs LEGADOS (pré-migration, sync_batch_id NULL) usam o próprio id -> cada
-- um vira um "batch" individual (não somem, nem se fundem num batch único).
runs_keyed as (
  select r.*, coalesce(r.sync_batch_id, r.id) as batch_key
  from public.meta_sync_runs r
),
-- batch (execução) mais recente do cliente
last_batch as (
  select distinct on (rk.client_id)
         rk.client_id, rk.batch_key, rk.started_at
  from runs_keyed rk
  order by rk.client_id, rk.started_at desc
),
batch_runs as (
  select lb.client_id, lb.batch_key,
         min(rk.started_at) as started_at,
         max(rk.finished_at) as finished_at,
         array_agg(rk.status::text) as statuses,
         array_agg(coalesce(rk.stats -> 'creatives' ->> 'degraded','')) as cre_degraded,
         array_agg(coalesce(rk.stats -> 'creatives' ->> 'upserted','')) as cre_upserted,
         array_agg(coalesce(rk.stats -> 'creatives' ->> 'minimal_only','')) as cre_minonly,
         array_agg(coalesce(rk.stats -> 'creatives' ->> 'failed','')) as cre_failed,
         bool_or(rk.stats ? 'creatives' and (rk.stats -> 'creatives') is not null) as any_creatives
  from last_batch lb
  join runs_keyed rk
    on rk.client_id = lb.client_id and rk.batch_key = lb.batch_key
  group by lb.client_id, lb.batch_key
)
select
  coalesce(pc.client_id, br.client_id) as client_id,
  pc.performance_synced_at,
  case
    when pc.performance_synced_at is null then 'never'
    when pc.performance_synced_at >= now() - interval '8 hours' then 'fresh'
    else 'stale'
  end as performance_status,
  br.finished_at as last_sync_at,
  case
    when br.statuses is null then 'never'
    when 'running' = any(br.statuses) then 'running'
    when br.statuses <@ array['success'] then 'success'
    when br.statuses <@ array['error'] then 'failed'
    else 'partial'
  end as last_sync_status,
  br.batch_key as last_batch_id,
  case
    when br.any_creatives is not true then 'never'
    when (select bool_or(x <> '0' and x <> '') from unnest(br.cre_failed) x)
      or (select bool_or(x <> '0' and x <> '') from unnest(br.cre_minonly) x)
      or (select bool_or(x = 'true') from unnest(br.cre_degraded) x)
      then case
             when (select bool_or(u = '0' or u = '') from unnest(br.cre_upserted) u)
                  and (select bool_or(x <> '0' and x <> '') from unnest(br.cre_failed) x)
             then 'failed'
             else 'partial'
           end
    when (select bool_or(u <> '0' and u <> '') from unnest(br.cre_upserted) u) then 'ok'
    else 'unknown'
  end as creatives_status
from perf_per_client pc
full outer join batch_runs br on br.client_id = pc.client_id;

revoke all on public.meta_client_sync_health from public, anon;
grant select on public.meta_client_sync_health to authenticated, service_role;

comment on view public.meta_client_sync_health is
  'AUTO SYNC V1 — por CLIENTE: performance_synced_at/performance_status (só '
  'idade — uma tentativa falha NÃO envelhece dados válidos), last_sync_at/'
  'last_sync_status (agregado do BATCH mais recente, não da última conta a '
  'terminar), creatives_status (agregado entre contas do batch). '
  'security_invoker=true -> respeita a RLS de meta_sync_runs (can_access_client).';

-- -----------------------------------------------------------------------------
-- 8. quem está DUE — mesma elegibilidade da (4); decide por idade da
--    performance (não pelo status do último run)
-- -----------------------------------------------------------------------------
create or replace function public.meta_clients_due_for_sync(
  p_limit   integer  default 8,
  p_min_age interval default interval '4 hours'
)
returns table (client_id uuid)
language sql
security definer
set search_path = ''
as $$
  select distinct on (e.client_id) e.client_id
  from public.meta_eligible_ad_accounts e
  left join public.meta_client_sync_health h on h.client_id = e.client_id
  where (h.performance_synced_at is null
         or h.performance_synced_at < now() - p_min_age)
    -- nada `running` para nenhuma conta deste cliente
    and not exists (
      select 1 from public.meta_sync_runs r
      where r.ad_account_ref = e.ad_account_ref
        and r.status = 'running'
        and r.started_at > now() - interval '20 minutes'
    )
  order by e.client_id, h.performance_synced_at asc nulls first
  limit greatest(coalesce(p_limit, 8), 1);
$$;

revoke all on function public.meta_clients_due_for_sync(integer, interval)
  from public, anon, authenticated;
grant execute on function public.meta_clients_due_for_sync(integer, interval)
  to service_role;

comment on function public.meta_clients_due_for_sync(integer, interval) is
  'AUTO SYNC V1 — dispatcher: até p_limit clientes DISTINTOS elegíveis '
  '(meta_eligible_ad_accounts), mais atrasados primeiro, cuja performance_synced_at '
  'é NULL ou > p_min_age. Tentativa falha mantém o timestamp válido -> cliente '
  'segue due e é repescado.';

-- -----------------------------------------------------------------------------
-- 8b. estado REAL do scheduler (sem tabela/config nova): o job existe e está
--     ativo em cron.job? Enquanto o bloco cron.schedule abaixo não for
--     executado, devolve false -> a UI mostra "Inativa". Depois de ativar,
--     passa a true sozinho.
-- -----------------------------------------------------------------------------
create or replace function public.meta_auto_sync_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from cron.job
    where jobname = 'meta-auto-sync-dispatch' and active
  );
$$;

revoke all on function public.meta_auto_sync_enabled() from public, anon;
grant execute on function public.meta_auto_sync_enabled() to authenticated, service_role;

comment on function public.meta_auto_sync_enabled() is
  'AUTO SYNC V1 — true se o job cron `meta-auto-sync-dispatch` existe e está '
  'ativo. Fonte real do estado do scheduler para a UI, sem tabela/flag nova.';

-- =============================================================================
-- 9. CRON — NÃO ATIVADO. Rode o bloco abaixo (SQL ou UI do Supabase Cron)
--    SÓ quando autorizar. O secret vem do Vault; nunca fica no arquivo.
--
--    Pré-requisitos (manuais, fora desta migration):
--      select vault.create_secret('<VALOR_ALEATORIO>', 'meta_sync_cron_secret',
--             'header x-meta-sync-cron-secret p/ meta-sync-scheduled');
--      supabase secrets set META_SYNC_CRON_SECRET=<MESMO_VALOR>
--      supabase functions deploy meta-sync-scheduled --no-verify-jwt
--
--    select cron.schedule(
--      'meta-auto-sync-dispatch',
--      '*/15 * * * *',
--      $cron$
--      select net.http_post(
--        url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/meta-sync-scheduled',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'x-meta-sync-cron-secret',
--          (select decrypted_secret from vault.decrypted_secrets
--            where name = 'meta_sync_cron_secret')
--        ),
--        body    := jsonb_build_object('clientId', d.client_id::text)
--      )
--      from public.meta_clients_due_for_sync(8, interval '4 hours') d;
--      $cron$
--    );
--
--    Desligar:  select cron.unschedule('meta-auto-sync-dispatch');
-- =============================================================================

-- =============================================================================
-- VALIDAÇÃO manual de isolamento da view (rodar como dois client_user distintos):
--   set role authenticated;  -- + jwt claims do usuário A
--   select client_id from public.meta_client_sync_health;   -- só clients de A
--   reset role;
-- =============================================================================

-- =============================================================================
-- ROLLBACK (manual):
--   select cron.unschedule('meta-auto-sync-dispatch');   -- se ativado
--   drop function if exists public.meta_auto_sync_enabled();
--   drop function if exists public.meta_clients_due_for_sync(integer, interval);
--   drop view if exists public.meta_client_sync_health;
--   drop function if exists public.meta_essential_stages();
--   drop function if exists public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid);
--   drop function if exists public.meta_sync_gc_stale(uuid);
--   drop view if exists public.meta_eligible_ad_accounts;
--   drop index if exists public.meta_creatives_details_stale_idx;
--   alter table public.meta_creatives drop column if exists details_fetched_at;
--   drop index if exists public.meta_sync_runs_batch_idx;
--   alter table public.meta_sync_runs drop column if exists sync_batch_id;
-- =============================================================================
