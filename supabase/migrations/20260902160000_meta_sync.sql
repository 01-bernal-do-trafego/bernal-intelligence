-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 5 (primeira sincronização real)
-- Migration: 20260902160000_meta_sync
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar. Idempotente.
--
-- Depende da META 1 (20260902130000): public.meta_sync_runs, tipos
-- public.meta_sync_status / public.meta_sync_trigger.
--
-- O QUE ADICIONA
--   (a) índice único PARCIAL em meta_sync_runs (ad_account_ref) WHERE
--       status='running' -> no máximo UMA sincronização rodando por conta,
--       garantido pelo banco (trava de concorrência).
--   (b) meta_sync_acquire(...) -> limpa runs 'running' presos (> 20 min) como
--       stale, insere o run novo e devolve o id; unique_violation vira
--       'sync_already_running'. Passos 1+2 numa transação (sem corrida).
--   (c) meta_sync_release(run_id, status, stats, error) -> finaliza o run.
--
--   A estrutura (meta_campaigns/adsets/ads) e os insights
--   (meta_insights_daily/periodic) são gravados DIRETO pelo service_role na
--   Edge Function `meta-sync` (upsert on conflict pelo id da Meta / pela chave
--   de insight) — a META 1 já previu isso. Aqui só entram os objetos de
--   controle da rodada.
--
--   SECURITY DEFINER, search_path='', EXECUTE só service_role.
-- =============================================================================

-- (a) trava de concorrência: 1 run 'running' por conta
create unique index if not exists meta_sync_runs_one_running
  on public.meta_sync_runs (ad_account_ref)
  where status = 'running';

-- (b) adquire o "lock" da sincronização
create or replace function public.meta_sync_acquire(
  p_client_id       uuid,
  p_connection_id   uuid,
  p_ad_account_ref  uuid,
  p_trigger         public.meta_sync_trigger,
  p_date_from       date,
  p_date_to         date,
  p_created_by      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_client_id is null or p_ad_account_ref is null then
    raise exception 'p_client_id e p_ad_account_ref são obrigatórios';
  end if;

  -- a conta tem que ser do cliente
  if not exists (
    select 1 from public.meta_ad_accounts
    where id = p_ad_account_ref and client_id = p_client_id
  ) then
    raise exception 'conta % não pertence ao cliente %', p_ad_account_ref, p_client_id;
  end if;

  -- 1. runs 'running' presos há mais de 20 min = stale (Edge Function caiu)
  update public.meta_sync_runs
  set status = 'error',
      error_text = coalesce(error_text, 'stale: excedeu o tempo limite'),
      finished_at = now()
  where ad_account_ref = p_ad_account_ref
    and status = 'running'
    and started_at < now() - interval '20 minutes';

  -- 2. cria o run novo; se já houver um 'running', o índice parcial barra
  begin
    insert into public.meta_sync_runs (
      client_id, connection_id, ad_account_ref, trigger, status,
      date_from, date_to, created_by, started_at
    ) values (
      p_client_id, p_connection_id, p_ad_account_ref, coalesce(p_trigger, 'manual'),
      'running', p_date_from, p_date_to, p_created_by, now()
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'sync_already_running';
  end;

  return v_id;
end;
$$;

comment on function public.meta_sync_acquire(uuid, uuid, uuid, public.meta_sync_trigger, date, date, uuid) is
  'META 5 — abre um meta_sync_runs (status=running) com trava de concorrência '
  'por conta (limpa runs presos > 20 min). Só service_role.';

-- (c) finaliza o run
create or replace function public.meta_sync_release(
  p_run_id uuid,
  p_status public.meta_sync_status,
  p_stats  jsonb,
  p_error  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'running' then
    raise exception 'meta_sync_release não aceita status running';
  end if;
  update public.meta_sync_runs
  set status      = p_status,
      stats       = coalesce(p_stats, '{}'::jsonb),
      error_text  = p_error,           -- o chamador garante: sem token/segredo
      finished_at = now()
  where id = p_run_id;
end;
$$;

comment on function public.meta_sync_release(uuid, public.meta_sync_status, jsonb, text) is
  'META 5 — finaliza um meta_sync_runs. error_text já vem sanitizado. Só service_role.';

-- (d) upsert dos insights AGREGADOS de período. Alvo de conflito explícito
--     (o índice único é PARCIAL: where period_key <> 'custom') para não
--     depender da inferência do PostgREST. Só presets aqui (period_key
--     nunca é 'custom' nesta etapa).
create or replace function public.meta_upsert_insights_periodic(
  p_client_id      uuid,
  p_ad_account_ref uuid,
  p_rows           jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_client_id is null or p_ad_account_ref is null then
    raise exception 'p_client_id e p_ad_account_ref são obrigatórios';
  end if;
  if not exists (
    select 1 from public.meta_ad_accounts
    where id = p_ad_account_ref and client_id = p_client_id
  ) then
    raise exception 'conta % não pertence ao cliente %', p_ad_account_ref, p_client_id;
  end if;

  with src as (
    select
      p_client_id                              as client_id,
      p_ad_account_ref                         as ad_account_ref,
      (r->>'level')::public.meta_insight_level  as level,
      r->>'entity_id'                           as entity_id,
      r->>'ad_account_id'                       as ad_account_id,
      nullif(r->>'campaign_id','')             as campaign_id,
      nullif(r->>'adset_id','')                as adset_id,
      nullif(r->>'ad_id','')                   as ad_id,
      coalesce(nullif(r->>'period_key',''), 'last_30d') as period_key,
      (r->>'date_from')::date                   as date_from,
      (r->>'date_to')::date                     as date_to,
      coalesce(nullif(r->>'attribution_window',''), '7d_click_1d_view') as attribution_window,
      nullif(r->>'currency','')               as currency,
      nullif(r->>'spend','')::numeric          as spend,
      nullif(r->>'impressions','')::bigint     as impressions,
      nullif(r->>'reach','')::bigint           as reach,
      nullif(r->>'clicks','')::bigint          as clicks,
      nullif(r->>'inline_link_clicks','')::bigint as inline_link_clicks,
      nullif(r->>'frequency','')::numeric      as frequency
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
    where r->>'entity_id' is not null and r->>'period_key' <> 'custom'
  ),
  up as (
    insert into public.meta_insights_periodic (
      client_id, ad_account_ref, level, entity_id, ad_account_id,
      campaign_id, adset_id, ad_id, period_key, date_from, date_to,
      attribution_window, currency, spend, impressions, reach, clicks,
      inline_link_clicks, frequency, synced_at
    )
    select
      client_id, ad_account_ref, level, entity_id, ad_account_id,
      campaign_id, adset_id, ad_id, period_key, date_from, date_to,
      attribution_window, currency, spend, impressions, reach, clicks,
      inline_link_clicks, frequency, now()
    from src
    on conflict (level, entity_id, period_key, attribution_window)
      where period_key <> 'custom'
    do update set
      ad_account_ref     = excluded.ad_account_ref,
      ad_account_id      = excluded.ad_account_id,
      campaign_id        = excluded.campaign_id,
      adset_id           = excluded.adset_id,
      ad_id              = excluded.ad_id,
      date_from          = excluded.date_from,
      date_to            = excluded.date_to,
      currency           = excluded.currency,
      spend              = excluded.spend,
      impressions        = excluded.impressions,
      reach              = excluded.reach,
      clicks             = excluded.clicks,
      inline_link_clicks = excluded.inline_link_clicks,
      frequency          = excluded.frequency,
      synced_at          = now()
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end;
$$;

comment on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb) is
  'META 5 — upsert dos totais de período (reach/frequency com regras do Ads '
  'Manager). Conflito explícito no índice parcial. Só service_role.';

-- privilégios
revoke all on function public.meta_sync_acquire(uuid, uuid, uuid, public.meta_sync_trigger, date, date, uuid)
  from anon, authenticated, public;
grant execute on function public.meta_sync_acquire(uuid, uuid, uuid, public.meta_sync_trigger, date, date, uuid)
  to service_role;

revoke all on function public.meta_sync_release(uuid, public.meta_sync_status, jsonb, text)
  from anon, authenticated, public;
grant execute on function public.meta_sync_release(uuid, public.meta_sync_status, jsonb, text)
  to service_role;

revoke all on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb)
  from anon, authenticated, public;
grant execute on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb)
  to service_role;

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop function if exists public.meta_upsert_insights_periodic(uuid, uuid, jsonb);
--   drop function if exists public.meta_sync_release(uuid, public.meta_sync_status, jsonb, text);
--   drop function if exists public.meta_sync_acquire(uuid, uuid, uuid, public.meta_sync_trigger, date, date, uuid);
--   drop index if exists public.meta_sync_runs_one_running;
-- =============================================================================
