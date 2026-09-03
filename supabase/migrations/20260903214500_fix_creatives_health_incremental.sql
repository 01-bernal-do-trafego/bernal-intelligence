-- =============================================================================
-- FIX ADITIVO — meta_client_sync_health.creatives_status em regime INCREMENTAL
-- -----------------------------------------------------------------------------
-- A view (aplicada em 20260903193000_meta_auto_sync.sql — NÃO EDITAR) só
-- classificava `creatives_status = 'ok'` quando `upserted > 0`. Em steady-state
-- o comportamento SAUDÁVEL do creative sync incremental é:
--   referenced > 0, known_skipped = referenced, upserted = 0,
--   failed = 0, minimal_only = 0, degraded = false
-- e isso caía em `'unknown'` (validado no batch manual 6636088e).
--
-- Nova regra — baseada na SAÚDE da etapa, não na quantidade de inserts:
--   unknown -> nenhum run do batch tem `stats.creatives` como objeto reconhecido
--   failed  -> há failed E nenhuma conta salvou nada (falha completa)
--   partial -> alguma conta com failed>0 OU minimal_only>0 OU degraded=true
--   ok      -> `stats.creatives` existe E failed=0 E minimal_only=0 E
--              degraded=false  (INDEPENDE de upserted)
--
-- Esta migration faz SOMENTE `create or replace view` — inalterado:
-- performance_synced_at/performance_status, last_sync_at/last_sync_status,
-- last_batch_id, coalesce(sync_batch_id, id) p/ runs legados, agregação
-- multi-conta, security_invoker=true, grants. Só a classificação de
-- creatives_status muda (e `any_creatives` passa a exigir objeto JSON).
-- =============================================================================

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
         bool_or(jsonb_typeof(rk.stats -> 'creatives') = 'object') as any_creatives
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
    -- sem stats.creatives reconhecido em nenhum run do batch
    when br.any_creatives is not true then 'unknown'
    -- alguma conta com problema real -> partial (ou failed se completa)
    when (select bool_or(x <> '0' and x <> '') from unnest(br.cre_failed) x)
      or (select bool_or(x <> '0' and x <> '') from unnest(br.cre_minonly) x)
      or (select bool_or(x = 'true') from unnest(br.cre_degraded) x)
      then case
             when (select bool_and(u = '0' or u = '') from unnest(br.cre_upserted) u)
                  and (select bool_or(x <> '0' and x <> '') from unnest(br.cre_failed) x)
             then 'failed'
             else 'partial'
           end
    -- stats existe e SEM failed/minimal_only/degraded -> ok (independe de upserted:
    -- known_skipped = referenced é o normal do incremental em steady-state)
    else 'ok'
  end as creatives_status
from perf_per_client pc
full outer join batch_runs br on br.client_id = pc.client_id;

revoke all on public.meta_client_sync_health from public, anon;
grant select on public.meta_client_sync_health to authenticated, service_role;

comment on view public.meta_client_sync_health is
  'AUTO SYNC V1 — por CLIENTE: performance_synced_at/performance_status (só '
  'idade — uma tentativa falha NÃO envelhece dados válidos), last_sync_at/'
  'last_sync_status (agregado do BATCH mais recente, não da última conta a '
  'terminar), creatives_status (saúde da etapa: ok se sem failed/minimal_only/'
  'degraded, INDEPENDE de upserted — incremental steady-state é upserted=0). '
  'security_invoker=true -> respeita a RLS de meta_sync_runs (can_access_client). '
  'Fix 20260903214500.';
