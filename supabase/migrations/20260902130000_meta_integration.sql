-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 1 (estrutura de dados)
-- Migration: 20260902130000_meta_integration
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (SQL Editor ou `supabase db push`).
--     Idempotente (create ... if not exists / or replace / drop policy if exists).
--
-- Reaproveita da migration de fundação (20260901120000):
--   public.can_access_client(uuid), public.is_agency(), public.is_agency_admin(),
--   public.set_updated_at()
--
-- Modelo:
--   clients (existente)
--     └─ meta_connections            (credencial; 1 cliente → N conexões)
--          └─ meta_ad_accounts       (act_…; 1 cliente → N contas)
--               ├─ meta_campaigns
--               │    └─ meta_adsets
--               │         └─ meta_ads ──► creative_id
--               ├─ meta_creatives     (ENTIDADE; visuais nullable)
--               ├─ meta_ad_creatives  (histórico ad ↔ creative, N:N no tempo)
--               └─ meta_insights_daily (fato: level+entity+date+attribution)
--     meta_sync_runs                  (auditoria de sincronização)
--
-- "creative-analysis" NÃO é um nível de insights: é derivado de
-- meta_ads.creative_id + meta_creatives + meta_insights_daily(level='ad').
--
-- ESCRITA nas tabelas meta_* é feita SOMENTE pelo serviço de sincronização
-- (service_role / Edge Function). O app Next tem acesso de LEITURA (RLS) e,
-- para credenciais, lê a VIEW meta_connections_safe (sem colunas de token).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.meta_token_type as enum
    ('user', 'system_user', 'system_user_60d', 'system_user_manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meta_connection_status as enum
    ('active', 'expiring', 'expired', 'revoked', 'reauthorization_required');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meta_insight_level as enum
    ('account', 'campaign', 'adset', 'ad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meta_sync_status as enum
    ('running', 'success', 'partial', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meta_sync_trigger as enum
    ('manual', 'cron', 'backfill');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. meta_connections — credencial Meta ligada a um cliente
-- -----------------------------------------------------------------------------
create table if not exists public.meta_connections (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients (id) on delete cascade,
  label                  text,
  token_type             public.meta_token_type not null,
  meta_user_id           text,
  meta_business_id       text,
  scopes                 text[] not null default '{}',

  -- token cifrado (AES-256-GCM). A chave vive só nos secrets da Edge Function.
  token_cipher           bytea,
  token_iv               bytea,
  token_tag              bytea,

  status                 public.meta_connection_status not null default 'reauthorization_required',
  status_reason          text,
  expires_at             timestamptz,       -- null = não expira
  data_access_expires_at timestamptz,
  last_verified_at       timestamptz,
  last_refresh_at        timestamptz,
  last_error             text,

  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint meta_connections_token_parts_consistent check (
    (token_cipher is null and token_iv is null and token_tag is null)
    or (token_cipher is not null and token_iv is not null and token_tag is not null)
  )
);

comment on table public.meta_connections is
  'Credencial Meta por cliente (1 cliente → N conexões). Token cifrado; nunca lido pelo app Next (usar view meta_connections_safe).';

create index if not exists meta_connections_client_idx  on public.meta_connections (client_id);
create index if not exists meta_connections_status_idx  on public.meta_connections (status);
create index if not exists meta_connections_expires_idx on public.meta_connections (expires_at) where expires_at is not null;

create or replace trigger meta_connections_set_updated_at
  before update on public.meta_connections
  for each row execute function public.set_updated_at();

-- View SEGURA: tudo menos as colunas de token. É a única que o Next consulta.
create or replace view public.meta_connections_safe
  with (security_invoker = true) as
select
  id, client_id, label, token_type, meta_user_id, meta_business_id, scopes,
  status, status_reason, expires_at, data_access_expires_at,
  last_verified_at, last_refresh_at, last_error,
  created_by, created_at, updated_at
from public.meta_connections;

comment on view public.meta_connections_safe is
  'meta_connections sem as colunas de token. security_invoker => respeita a RLS do usuário.';

-- -----------------------------------------------------------------------------
-- 3. meta_ad_accounts — contas de anúncio descobertas / vinculadas
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ad_accounts (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete cascade,
  connection_id      uuid not null references public.meta_connections (id) on delete cascade,
  ad_account_id      text not null,                  -- "act_1234567890" (id original Meta)
  account_name       text,
  account_status     integer,                        -- 1 = ativa
  currency           text,
  timezone_name      text,
  timezone_offset_utc integer,
  business_id        text,
  business_name      text,
  is_linked          boolean not null default false, -- conta escolhida para o cliente
  sync_enabled       boolean not null default false,
  last_sync_at       timestamptz,
  last_sync_status   public.meta_sync_status,
  last_sync_error    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (connection_id, ad_account_id)
);

comment on table public.meta_ad_accounts is
  'Contas Meta por cliente (N por cliente). is_linked = escolhida para veiculação neste cliente.';

-- Uma conta Meta fica vinculada a um cliente no máximo uma vez.
create unique index if not exists meta_ad_accounts_linked_unique
  on public.meta_ad_accounts (client_id, ad_account_id) where is_linked;

create index if not exists meta_ad_accounts_client_idx  on public.meta_ad_accounts (client_id);
create index if not exists meta_ad_accounts_linked_idx  on public.meta_ad_accounts (client_id, is_linked);
create index if not exists meta_ad_accounts_conn_idx    on public.meta_ad_accounts (connection_id);

create or replace trigger meta_ad_accounts_set_updated_at
  before update on public.meta_ad_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. meta_campaigns
-- -----------------------------------------------------------------------------
create table if not exists public.meta_campaigns (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  ad_account_ref   uuid not null references public.meta_ad_accounts (id) on delete cascade,
  ad_account_id    text not null,
  campaign_id      text not null,
  name             text,
  objective        text,
  status           text,
  effective_status text,
  buying_type      text,
  daily_budget     numeric,
  lifetime_budget  numeric,
  budget_remaining numeric,
  created_time     timestamptz,
  updated_time     timestamptz,
  start_time       timestamptz,
  stop_time        timestamptz,
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (campaign_id)
);

create index if not exists meta_campaigns_client_idx  on public.meta_campaigns (client_id);
create index if not exists meta_campaigns_account_idx on public.meta_campaigns (ad_account_ref);

create or replace trigger meta_campaigns_set_updated_at
  before update on public.meta_campaigns
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. meta_adsets
-- -----------------------------------------------------------------------------
create table if not exists public.meta_adsets (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  ad_account_ref    uuid not null references public.meta_ad_accounts (id) on delete cascade,
  campaign_ref      uuid references public.meta_campaigns (id) on delete set null,
  ad_account_id     text not null,
  campaign_id       text,
  adset_id          text not null,
  name              text,
  status            text,
  effective_status  text,
  optimization_goal text,
  billing_event     text,
  bid_strategy      text,
  daily_budget      numeric,
  lifetime_budget   numeric,
  start_time        timestamptz,
  end_time          timestamptz,
  promoted_object   jsonb,
  created_time      timestamptz,
  updated_time      timestamptz,
  synced_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (adset_id)
);

create index if not exists meta_adsets_client_idx   on public.meta_adsets (client_id);
create index if not exists meta_adsets_campaign_idx on public.meta_adsets (campaign_ref);
create index if not exists meta_adsets_account_idx  on public.meta_adsets (ad_account_ref);

create or replace trigger meta_adsets_set_updated_at
  before update on public.meta_adsets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. meta_ads
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ads (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  ad_account_ref   uuid not null references public.meta_ad_accounts (id) on delete cascade,
  campaign_ref     uuid references public.meta_campaigns (id) on delete set null,
  adset_ref        uuid references public.meta_adsets (id) on delete set null,
  ad_account_id    text not null,
  campaign_id      text,
  adset_id         text,
  ad_id            text not null,
  name             text,
  status           text,
  effective_status text,
  creative_id      text,               -- criativo atual do anúncio (Meta id)
  created_time     timestamptz,
  updated_time     timestamptz,
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (ad_id)
);

create index if not exists meta_ads_client_idx   on public.meta_ads (client_id);
create index if not exists meta_ads_adset_idx    on public.meta_ads (adset_ref);
create index if not exists meta_ads_account_idx  on public.meta_ads (ad_account_ref);
create index if not exists meta_ads_creative_idx on public.meta_ads (creative_id) where creative_id is not null;

create or replace trigger meta_ads_set_updated_at
  before update on public.meta_ads
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. meta_creatives — ENTIDADE (não métrica). Todos os visuais NULLABLE.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_creatives (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete cascade,
  ad_account_ref        uuid not null references public.meta_ad_accounts (id) on delete cascade,
  ad_account_id         text not null,
  creative_id           text not null,
  name                  text,
  object_type           text,
  format                text,     -- normalizado: image | video | carousel | dynamic | unknown
  thumbnail_url         text,
  image_url             text,
  video_id              text,
  title                 text,     -- headline
  body                  text,     -- texto principal
  description           text,
  call_to_action_type   text,
  link_url              text,
  asset_feed_spec       jsonb,    -- dynamic creative
  raw                   jsonb,    -- bruto reduzido (só o necessário p/ preview)
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (creative_id),
  constraint meta_creatives_format_valid check (
    format is null
    or format in ('image', 'video', 'carousel', 'dynamic', 'unknown')
  )
);

create index if not exists meta_creatives_client_idx  on public.meta_creatives (client_id);
create index if not exists meta_creatives_account_idx on public.meta_creatives (ad_account_ref);

create or replace trigger meta_creatives_set_updated_at
  before update on public.meta_creatives
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. meta_ad_creatives — histórico ad ↔ creative (N anúncios podem usar o
--    mesmo criativo; um anúncio pode trocar de criativo ao longo do tempo)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ad_creatives (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  ad_ref       uuid not null references public.meta_ads (id) on delete cascade,
  creative_ref uuid not null references public.meta_creatives (id) on delete cascade,
  ad_id        text not null,
  creative_id  text not null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (ad_id, creative_id)
);

create index if not exists meta_ad_creatives_creative_idx on public.meta_ad_creatives (creative_ref);
create index if not exists meta_ad_creatives_ad_idx       on public.meta_ad_creatives (ad_ref);
create index if not exists meta_ad_creatives_client_idx   on public.meta_ad_creatives (client_id);

create or replace trigger meta_ad_creatives_set_updated_at
  before update on public.meta_ad_creatives
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 9. meta_insights_daily — TABELA-FATO
--    Uma linha por (level, entity_id, date, attribution_window).
--    NULL numa coluna nativa = ausência (a Meta não devolveu). 0 = zero real.
--    `actions` / `action_values` = cauda longa normalizada { metric_id: valor }.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_insights_daily (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  ad_account_ref      uuid not null references public.meta_ad_accounts (id) on delete cascade,
  level               public.meta_insight_level not null,
  entity_id           text not null,                 -- id Meta da entidade daquele nível
  ad_account_id       text not null,
  campaign_id         text,
  adset_id            text,
  ad_id               text,
  date                date not null,
  attribution_window  text not null default '7d_click_1d_view',
  currency            text,

  -- colunas nativas fixas
  spend                   numeric,
  impressions             bigint,
  reach                   bigint,
  clicks                  bigint,
  inline_link_clicks      bigint,
  frequency               numeric,
  video_3s_views          bigint,
  video_thruplays         bigint,
  video_avg_time_watched  numeric,

  -- cauda longa normalizada
  actions          jsonb not null default '{}'::jsonb,
  action_values    jsonb not null default '{}'::jsonb,
  unmapped_actions jsonb not null default '[]'::jsonb,

  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (level, entity_id, date, attribution_window),

  constraint meta_insights_level_ids check (
    (level = 'account')
    or (level = 'campaign' and campaign_id is not null)
    or (level = 'adset'    and campaign_id is not null and adset_id is not null)
    or (level = 'ad'       and campaign_id is not null and adset_id is not null and ad_id is not null)
  ),
  constraint meta_insights_nonneg check (
    coalesce(spend, 0) >= 0 and coalesce(impressions, 0) >= 0
    and coalesce(reach, 0) >= 0 and coalesce(clicks, 0) >= 0
    and coalesce(frequency, 0) >= 0
  )
);

comment on table public.meta_insights_daily is
  'Fato diário normalizado. O dashboard lê SÓ daqui — a Meta nunca é chamada no carregamento. Upsert por (level, entity_id, date, attribution_window) => sincronização idempotente.';

create index if not exists meta_insights_client_level_date_idx on public.meta_insights_daily (client_id, level, date);
create index if not exists meta_insights_ad_date_idx           on public.meta_insights_daily (ad_id, date) where ad_id is not null;
create index if not exists meta_insights_campaign_date_idx     on public.meta_insights_daily (campaign_id, date) where campaign_id is not null;
create index if not exists meta_insights_adset_date_idx        on public.meta_insights_daily (adset_id, date) where adset_id is not null;
create index if not exists meta_insights_account_date_idx      on public.meta_insights_daily (ad_account_ref, date);

create or replace trigger meta_insights_daily_set_updated_at
  before update on public.meta_insights_daily
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 10. meta_sync_runs — auditoria de sincronização
-- -----------------------------------------------------------------------------
create table if not exists public.meta_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  connection_id  uuid references public.meta_connections (id) on delete set null,
  ad_account_ref uuid references public.meta_ad_accounts (id) on delete set null,
  trigger        public.meta_sync_trigger not null default 'manual',
  status         public.meta_sync_status not null default 'running',
  date_from      date,
  date_to        date,
  stats          jsonb not null default '{}'::jsonb,
  error_text     text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists meta_sync_runs_client_idx on public.meta_sync_runs (client_id, started_at desc);

create or replace trigger meta_sync_runs_set_updated_at
  before update on public.meta_sync_runs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 11. Privilégios — anon: nada. authenticated: SÓ leitura. Escrita = service_role.
-- -----------------------------------------------------------------------------
revoke all on
  public.meta_connections, public.meta_ad_accounts, public.meta_campaigns,
  public.meta_adsets, public.meta_ads, public.meta_creatives,
  public.meta_ad_creatives, public.meta_insights_daily, public.meta_sync_runs
  from anon, public;

grant select on
  public.meta_ad_accounts, public.meta_campaigns, public.meta_adsets,
  public.meta_ads, public.meta_creatives, public.meta_ad_creatives,
  public.meta_insights_daily, public.meta_sync_runs
  to authenticated;

-- meta_connections: leitura só pela view segura.
revoke all on public.meta_connections_safe from anon, public;
grant select on public.meta_connections_safe to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Row Level Security
--     SELECT: quem pode acessar o cliente (agency vê tudo; client_user só os
--     clientes ligados a ele). Sem policies de INSERT/UPDATE/DELETE para
--     `authenticated` => o app Next NÃO escreve nas tabelas meta_*.
--     `meta_connections`: leitura só para equipe (is_agency()).
-- -----------------------------------------------------------------------------
alter table public.meta_connections    enable row level security;
alter table public.meta_ad_accounts    enable row level security;
alter table public.meta_campaigns      enable row level security;
alter table public.meta_adsets         enable row level security;
alter table public.meta_ads            enable row level security;
alter table public.meta_creatives      enable row level security;
alter table public.meta_ad_creatives   enable row level security;
alter table public.meta_insights_daily enable row level security;
alter table public.meta_sync_runs      enable row level security;

drop policy if exists meta_connections_select on public.meta_connections;
create policy meta_connections_select on public.meta_connections
  for select to authenticated
  using ( public.is_agency() and public.can_access_client(client_id) );

drop policy if exists meta_ad_accounts_select on public.meta_ad_accounts;
create policy meta_ad_accounts_select on public.meta_ad_accounts
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_campaigns_select on public.meta_campaigns;
create policy meta_campaigns_select on public.meta_campaigns
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_adsets_select on public.meta_adsets;
create policy meta_adsets_select on public.meta_adsets
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_ads_select on public.meta_ads;
create policy meta_ads_select on public.meta_ads
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_creatives_select on public.meta_creatives;
create policy meta_creatives_select on public.meta_creatives
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_ad_creatives_select on public.meta_ad_creatives;
create policy meta_ad_creatives_select on public.meta_ad_creatives
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_insights_daily_select on public.meta_insights_daily;
create policy meta_insights_daily_select on public.meta_insights_daily
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_sync_runs_select on public.meta_sync_runs;
create policy meta_sync_runs_select on public.meta_sync_runs
  for select to authenticated using ( public.can_access_client(client_id) );

-- =============================================================================
-- IDEMPOTÊNCIA DA SINCRONIZAÇÃO (guia p/ META 5+)
--   entidades:  insert ... on conflict (<meta_id>) do update set ...
--   insights:   insert ... on conflict (level, entity_id, date, attribution_window)
--   ad↔creative: on conflict (ad_id, creative_id) do update set last_seen = now()
--   Rodar a sync N vezes NÃO duplica linhas.
-- =============================================================================

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop view  if exists public.meta_connections_safe;
--   drop table if exists public.meta_sync_runs      cascade;
--   drop table if exists public.meta_insights_daily cascade;
--   drop table if exists public.meta_ad_creatives   cascade;
--   drop table if exists public.meta_creatives      cascade;
--   drop table if exists public.meta_ads            cascade;
--   drop table if exists public.meta_adsets         cascade;
--   drop table if exists public.meta_campaigns      cascade;
--   drop table if exists public.meta_ad_accounts    cascade;
--   drop table if exists public.meta_connections    cascade;
--   drop type  if exists public.meta_sync_trigger;
--   drop type  if exists public.meta_sync_status;
--   drop type  if exists public.meta_insight_level;
--   drop type  if exists public.meta_connection_status;
--   drop type  if exists public.meta_token_type;
-- =============================================================================
