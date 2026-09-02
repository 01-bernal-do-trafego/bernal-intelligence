-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · CONVERSÕES REAIS V1
-- Migration: 20260902170000_meta_conversions
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar. Idempotente (create or replace).
--
-- Depende da META 5 (20260902160000): função meta_upsert_insights_periodic.
--
-- O QUE MUDA
--   (a) IDENTIDADE DE ATRIBUIÇÃO. A sincronização NÃO força janela de
--       atribuição: a Insights API (desde 10/06/2025) já retorna
--       actions/action_values na configuração UNIFICADA de cada conjunto de
--       anúncios (= Ads Manager); `use_unified_attribution_setting` é
--       desconsiderado. O rótulo passa de `7d_click_1d_view` (que sugeria uma
--       janela fixa) para `unified_attribution`.
--       As linhas já sincronizadas (só métricas BASE — spend/impressions/
--       clicks/reach/frequency, que NÃO dependem de atribuição; actions vazias)
--       são RENOMEADAS in-place. Seguro e sem duplicar:
--         - cada (level, entity_id, date[/intervalo]) tinha exatamente UMA
--           linha `7d_click_1d_view` -> vira UMA `unified_attribution`;
--         - não existem linhas `unified_attribution` ainda -> zero colisão
--           (e o índice único abortaria se houvesse);
--         - o re-sync seguinte faz upsert SOBRE a linha renomeada (mesma
--           chave) e preenche os actions reais.
--
--   (b) `meta_upsert_insights_periodic` passa a gravar TAMBÉM as colunas jsonb
--       de conversão — `actions`, `action_values`, `raw_actions`,
--       `raw_action_values` — que já existem em `meta_insights_periodic`
--       (META 1) mas eram ignoradas pela RPC. E o fallback de
--       attribution_window vira `unified_attribution`.
--
--   `meta_insights_daily` é gravada por upsert direto do service_role (a Edge
--   Function já inclui os campos) — aqui só o UPDATE de renomeação e o default.
--
--   `actions` / `action_values`  = métricas Bernal já resolvidas por PRIORIDADE
--   (sem dupla contagem — ver supabase/functions/_shared/actions.ts).
--   `raw_actions` / `raw_action_values` = TODOS os action_type crus recebidos.
--
--   SECURITY DEFINER, search_path='', EXECUTE só service_role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) Transição do identificador de atribuição — in-place, idempotente.
--     WHERE = '7d_click_1d_view' -> 2ª execução é no-op.
-- -----------------------------------------------------------------------------
update public.meta_insights_daily
  set attribution_window = 'unified_attribution'
  where attribution_window = '7d_click_1d_view';

update public.meta_insights_periodic
  set attribution_window = 'unified_attribution'
  where attribution_window = '7d_click_1d_view';

alter table public.meta_insights_daily
  alter column attribution_window set default 'unified_attribution';
alter table public.meta_insights_periodic
  alter column attribution_window set default 'unified_attribution';

-- -----------------------------------------------------------------------------
-- (b) RPC dos agregados de período: grava conversões + fallback atualizado.
-- -----------------------------------------------------------------------------
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
      coalesce(nullif(r->>'period_key',''), 'custom') as period_key,
      (r->>'date_from')::date                   as date_from,
      (r->>'date_to')::date                     as date_to,
      coalesce(nullif(r->>'attribution_window',''), 'unified_attribution') as attribution_window,
      nullif(r->>'currency','')               as currency,
      nullif(r->>'spend','')::numeric          as spend,
      nullif(r->>'impressions','')::bigint     as impressions,
      nullif(r->>'reach','')::bigint           as reach,
      nullif(r->>'clicks','')::bigint          as clicks,
      nullif(r->>'inline_link_clicks','')::bigint as inline_link_clicks,
      nullif(r->>'frequency','')::numeric      as frequency,
      coalesce(r->'actions', '{}'::jsonb)              as actions,
      coalesce(r->'action_values', '{}'::jsonb)        as action_values,
      coalesce(r->'raw_actions', '{}'::jsonb)          as raw_actions,
      coalesce(r->'raw_action_values', '{}'::jsonb)    as raw_action_values
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
    where r->>'entity_id' is not null
      and r->>'date_from' ~ '^\d{4}-\d{2}-\d{2}$'
      and r->>'date_to'   ~ '^\d{4}-\d{2}-\d{2}$'
      and (r->>'date_from')::date <= (r->>'date_to')::date
  ),
  up as (
    insert into public.meta_insights_periodic (
      client_id, ad_account_ref, level, entity_id, ad_account_id,
      campaign_id, adset_id, ad_id, period_key, date_from, date_to,
      attribution_window, currency, spend, impressions, reach, clicks,
      inline_link_clicks, frequency,
      actions, action_values, raw_actions, raw_action_values,
      synced_at
    )
    select
      client_id, ad_account_ref, level, entity_id, ad_account_id,
      campaign_id, adset_id, ad_id, period_key, date_from, date_to,
      attribution_window, currency, spend, impressions, reach, clicks,
      inline_link_clicks, frequency,
      actions, action_values, raw_actions, raw_action_values,
      now()
    from src
    on conflict (level, entity_id, date_from, date_to, attribution_window)
    do update set
      ad_account_ref     = excluded.ad_account_ref,
      ad_account_id      = excluded.ad_account_id,
      campaign_id        = excluded.campaign_id,
      adset_id           = excluded.adset_id,
      ad_id              = excluded.ad_id,
      period_key         = excluded.period_key,
      currency           = excluded.currency,
      spend              = excluded.spend,
      impressions        = excluded.impressions,
      reach              = excluded.reach,
      clicks             = excluded.clicks,
      inline_link_clicks = excluded.inline_link_clicks,
      frequency          = excluded.frequency,
      actions            = excluded.actions,
      action_values      = excluded.action_values,
      raw_actions        = excluded.raw_actions,
      raw_action_values  = excluded.raw_action_values,
      synced_at          = now()
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end;
$$;

comment on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb) is
  'META 5 + CONVERSÕES V1 — upsert dos totais de período. Unicidade = intervalo. '
  'Grava também actions/action_values (resolvidos por prioridade, sem dupla '
  'contagem) e raw_actions/raw_action_values (crus, auditoria). Só service_role.';

-- privilégios (idempotente; a função já era só de service_role)
revoke all on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb)
  from anon, authenticated, public;
grant execute on function public.meta_upsert_insights_periodic(uuid, uuid, jsonb)
  to service_role;

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   update public.meta_insights_daily
--     set attribution_window = '7d_click_1d_view' where attribution_window = 'unified_attribution';
--   update public.meta_insights_periodic
--     set attribution_window = '7d_click_1d_view' where attribution_window = 'unified_attribution';
--   alter table public.meta_insights_daily    alter column attribution_window set default '7d_click_1d_view';
--   alter table public.meta_insights_periodic alter column attribution_window set default '7d_click_1d_view';
--   -- + reaplicar meta_upsert_insights_periodic da migration 20260902160000_meta_sync.sql.
-- Nenhuma tabela teve DDL de coluna alterado (só default + dados).
-- =============================================================================
