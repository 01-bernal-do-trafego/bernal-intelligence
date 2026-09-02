-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 1 (estrutura de dados)
-- Migration: 20260902130000_meta_integration
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (SQL Editor ou `supabase db push`).
--     Idempotente (create ... if not exists / or replace / drop policy if exists).
--
-- Reaproveita da fundação (20260901120000):
--   public.can_access_client(uuid), public.is_agency(), public.set_updated_at()
--
-- Modelo:
--   clients (existente)
--     └─ meta_connections            (metadados da credencial; SEM token)
--          ├─ meta_connection_secrets (bytes do token cifrado; SEM acesso p/ authenticated)
--          └─ meta_ad_accounts        (act_…; N por cliente; is_linked)
--               ├─ meta_campaigns → meta_adsets → meta_ads ──► creative_id
--               ├─ meta_creatives     (ENTIDADE; visuais nullable)
--               ├─ meta_ad_creatives  (histórico ad ↔ creative, N:N no tempo)
--               ├─ meta_insights_daily    (fato diário → GRÁFICOS temporais)
--               └─ meta_insights_periodic (agregado por período → CARDS/TOTAIS)
--     meta_sync_runs                  (auditoria de sincronização)
--
-- SEGURANÇA DO TOKEN
--   Os bytes cifrados ficam em `meta_connection_secrets`, tabela sem NENHUM
--   privilégio para `anon`/`authenticated` (revoke all) e com RLS habilitada
--   SEM policies (deny-all). Só `service_role` (Edge Function de sincronização)
--   acessa. `meta_connections` não tem colunas de token → é lida direto pelo
--   app, com RLS por cliente. Não há dependência de "o código não seleciona".
--
-- ESCRITA nas tabelas meta_* é feita SOMENTE pelo serviço de sincronização
-- (service_role). O app Next tem acesso de LEITURA (RLS) e nada mais.
--
-- IDs da Meta (ad_account_id, campaign_id, adset_id, ad_id, creative_id) são
-- GLOBALMENTE únicos → as unique keys usam o id da Meta (não incluem client_id).
-- O isolamento entre clientes é garantido por (a) `ad_account_id` linkado a no
-- máximo UM cliente e (b) trigger que proíbe reatribuir `client_id`.
--
-- "creative-analysis" NÃO é um nível de insights: é derivado de
-- meta_ads.creative_id + meta_creatives + meta_insights_*(level='ad').
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
-- 2. Guarda: proibir reatribuição de client_id em qualquer linha meta_*
--    (isolamento entre clientes — nem a sincronização pode "mover" dados).
-- -----------------------------------------------------------------------------
create or replace function public.meta_lock_client_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'client_id de registro Meta é imutável (isolamento entre clientes)';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. meta_connections — metadados da credencial (SEM bytes de token)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_connections (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients (id) on delete cascade,
  label                  text,
  token_type             public.meta_token_type not null,
  meta_user_id           text,
  meta_business_id       text,
  scopes                 text[] not null default '{}',

  status                 public.meta_connection_status not null default 'reauthorization_required',
  status_reason          text,
  expires_at             timestamptz,       -- null = não expira
  data_access_expires_at timestamptz,
  last_verified_at       timestamptz,
  last_refresh_at        timestamptz,
  last_error             text,
  /** true quando existe um segredo correspondente em meta_connection_secrets. */
  has_secret             boolean not null default false,

  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.meta_connections is
  'Credencial Meta por cliente (1 cliente → N conexões). SEM bytes de token: eles ficam em meta_connection_secrets.';

create index if not exists meta_connections_client_idx  on public.meta_connections (client_id);
create index if not exists meta_connections_status_idx  on public.meta_connections (status);
create index if not exists meta_connections_expires_idx on public.meta_connections (expires_at) where expires_at is not null;

create or replace trigger meta_connections_set_updated_at
  before update on public.meta_connections
  for each row execute function public.set_updated_at();
create or replace trigger meta_connections_lock_client
  before update on public.meta_connections
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 4. meta_connection_secrets — bytes do token (AES-256-GCM)
--    Sem grants p/ anon/authenticated. RLS ligada e SEM policies (deny-all).
--    Só service_role (Edge Function) lê/escreve. Chave de cifra vive nos
--    secrets da Edge Function, nunca no banco.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_connection_secrets (
  connection_id uuid primary key references public.meta_connections (id) on delete cascade,
  token_cipher  bytea not null,
  token_iv      bytea not null,
  token_tag     bytea not null,
  key_version   smallint not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.meta_connection_secrets is
  'Token da Meta cifrado. Sem acesso para anon/authenticated (revoke + RLS deny-all). Só service_role.';

create or replace trigger meta_connection_secrets_set_updated_at
  before update on public.meta_connection_secrets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. meta_ad_accounts — contas de anúncio descobertas / vinculadas
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ad_accounts (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  -- conexão que descobriu/mantém a conta. set null preserva a conta + histórico
  -- quando a conexão é removida (reconexão).
  connection_id       uuid references public.meta_connections (id) on delete set null,
  ad_account_id       text not null,                  -- "act_1234567890" (id Meta)
  account_name        text,
  account_status      integer,                        -- 1 = ativa
  currency            text,
  timezone_name       text,
  timezone_offset_utc integer,
  business_id         text,
  business_name       text,
  is_linked           boolean not null default false, -- conta escolhida para o cliente
  sync_enabled        boolean not null default false,
  last_sync_at        timestamptz,
  last_sync_status    public.meta_sync_status,
  last_sync_error     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- descoberta: 1 linha por (conexão, conta). NULLS NOT DISTINCT evita
  -- duplicar contas órfãs (connection_id nulo).
  constraint meta_ad_accounts_conn_account_uq
    unique nulls not distinct (connection_id, ad_account_id)
);

comment on table public.meta_ad_accounts is
  'Contas Meta por cliente (N por cliente). is_linked = conta ativa para veiculação. Uma conta linkada pertence a no máximo um cliente (índice global).';

-- Uma conta Meta fica LINKADA a no máximo UM cliente em todo o sistema.
create unique index if not exists meta_ad_accounts_linked_global_uq
  on public.meta_ad_accounts (ad_account_id) where is_linked;

create index if not exists meta_ad_accounts_client_idx on public.meta_ad_accounts (client_id);
create index if not exists meta_ad_accounts_linked_idx on public.meta_ad_accounts (client_id, is_linked);
create index if not exists meta_ad_accounts_conn_idx   on public.meta_ad_accounts (connection_id);

create or replace trigger meta_ad_accounts_set_updated_at
  before update on public.meta_ad_accounts
  for each row execute function public.set_updated_at();
create or replace trigger meta_ad_accounts_lock_client
  before update on public.meta_ad_accounts
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 6. meta_campaigns
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
  unique (campaign_id)              -- campaign_id da Meta é global
);

create index if not exists meta_campaigns_client_idx  on public.meta_campaigns (client_id);
create index if not exists meta_campaigns_account_idx on public.meta_campaigns (ad_account_ref);

create or replace trigger meta_campaigns_set_updated_at
  before update on public.meta_campaigns
  for each row execute function public.set_updated_at();
create or replace trigger meta_campaigns_lock_client
  before update on public.meta_campaigns
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 7. meta_adsets
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
create or replace trigger meta_adsets_lock_client
  before update on public.meta_adsets
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 8. meta_ads
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
  creative_id      text,               -- criativo atual (Meta id)
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
create or replace trigger meta_ads_lock_client
  before update on public.meta_ads
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 9. meta_creatives — ENTIDADE (não métrica). Todos os visuais NULLABLE.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_creatives (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  ad_account_ref      uuid not null references public.meta_ad_accounts (id) on delete cascade,
  ad_account_id       text not null,
  creative_id         text not null,
  name                text,
  object_type         text,
  format              text,   -- normalizado: image | video | carousel | dynamic | unknown
  thumbnail_url       text,
  image_url           text,
  video_id            text,
  title               text,   -- headline
  body                text,   -- texto principal
  description         text,
  call_to_action_type text,
  link_url            text,
  asset_feed_spec     jsonb,  -- dynamic creative
  raw                 jsonb,  -- bruto reduzido (só o necessário p/ preview)
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
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
create or replace trigger meta_creatives_lock_client
  before update on public.meta_creatives
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 10. meta_ad_creatives — histórico ad ↔ creative (N:N no tempo)
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
create or replace trigger meta_ad_creatives_lock_client
  before update on public.meta_ad_creatives
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 11. meta_insights_daily — FATO DIÁRIO (→ gráficos temporais)
--     `reach` diário É válido ponto a ponto no gráfico, mas NUNCA é somado
--     para obter alcance de período — para isso existe meta_insights_periodic.
--     NULL numa coluna nativa = ausência. 0 = zero real.
--     `actions`/`action_values` = métricas Bernal já resolvidas (prioridade/
--     fallback — sem dupla contagem). `raw_actions`/`raw_action_values` = TODOS
--     os action_types crus recebidos (valor na janela escolhida), p/
--     reconciliação com o Ads Manager e para novas métricas sem re-sync.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_insights_daily (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  ad_account_ref      uuid not null references public.meta_ad_accounts (id) on delete cascade,
  level               public.meta_insight_level not null,
  entity_id           text not null,
  ad_account_id       text not null,
  campaign_id         text,
  adset_id            text,
  ad_id               text,
  date                date not null,
  attribution_window  text not null default '7d_click_1d_view',
  currency            text,

  spend                   numeric,
  impressions             bigint,
  reach                   bigint,
  clicks                  bigint,
  inline_link_clicks      bigint,
  frequency               numeric,
  video_3s_views          bigint,
  video_thruplays         bigint,
  video_avg_time_watched  numeric,

  actions            jsonb not null default '{}'::jsonb,
  action_values      jsonb not null default '{}'::jsonb,
  raw_actions        jsonb not null default '{}'::jsonb,
  raw_action_values  jsonb not null default '{}'::jsonb,

  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (level, entity_id, date, attribution_window),

  constraint meta_insights_daily_level_ids check (
    (level = 'account')
    or (level = 'campaign' and campaign_id is not null)
    or (level = 'adset'    and campaign_id is not null and adset_id is not null)
    or (level = 'ad'       and campaign_id is not null and adset_id is not null and ad_id is not null)
  ),
  constraint meta_insights_daily_nonneg check (
    coalesce(spend, 0) >= 0 and coalesce(impressions, 0) >= 0
    and coalesce(reach, 0) >= 0 and coalesce(clicks, 0) >= 0
    and coalesce(frequency, 0) >= 0
  )
);

comment on table public.meta_insights_daily is
  'Fato diário para GRÁFICOS temporais. reach/frequency são por dia; totais de período vêm de meta_insights_periodic. Upsert por (level, entity_id, date, attribution_window) => idempotente.';

create index if not exists meta_insights_daily_client_level_date_idx on public.meta_insights_daily (client_id, level, date);
create index if not exists meta_insights_daily_ad_date_idx           on public.meta_insights_daily (ad_id, date) where ad_id is not null;
create index if not exists meta_insights_daily_campaign_date_idx     on public.meta_insights_daily (campaign_id, date) where campaign_id is not null;
create index if not exists meta_insights_daily_adset_date_idx        on public.meta_insights_daily (adset_id, date) where adset_id is not null;
create index if not exists meta_insights_daily_account_date_idx      on public.meta_insights_daily (ad_account_ref, date);

create or replace trigger meta_insights_daily_set_updated_at
  before update on public.meta_insights_daily
  for each row execute function public.set_updated_at();
create or replace trigger meta_insights_daily_lock_client
  before update on public.meta_insights_daily
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 12. meta_insights_periodic — AGREGADO POR PERÍODO (→ cards / totais)
--     Vem de UMA chamada de insights SEM time_increment (a Meta agrega com as
--     mesmas regras do Ads Manager). É a fonte correta de reach/frequency e o
--     total confiável de qualquer métrica no período.
--     `period_key`: 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d'
--                 | 'this_month' | 'last_month' | 'custom'.
--       presets  → 1 linha por (level, entity, period_key, attribution_window),
--                  sobrescrita a cada sync (janela móvel sempre atual).
--       custom   → 1 linha por (level, entity, date_from, date_to, attr_window),
--                  cache sob demanda; janelas antigas podem ser podadas.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_insights_periodic (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  ad_account_ref      uuid not null references public.meta_ad_accounts (id) on delete cascade,
  level               public.meta_insight_level not null,
  entity_id           text not null,
  ad_account_id       text not null,
  campaign_id         text,
  adset_id            text,
  ad_id               text,
  period_key          text not null,
  date_from           date not null,
  date_to             date not null,
  attribution_window  text not null default '7d_click_1d_view',
  currency            text,

  spend                   numeric,
  impressions             bigint,
  reach                   bigint,   -- ALCANCE CORRETO do período (não somado)
  clicks                  bigint,
  inline_link_clicks      bigint,
  frequency               numeric,  -- FREQUÊNCIA CORRETA do período
  video_3s_views          bigint,
  video_thruplays         bigint,
  video_avg_time_watched  numeric,

  actions            jsonb not null default '{}'::jsonb,
  action_values      jsonb not null default '{}'::jsonb,
  raw_actions        jsonb not null default '{}'::jsonb,
  raw_action_values  jsonb not null default '{}'::jsonb,

  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint meta_insights_periodic_range check (date_from <= date_to),
  constraint meta_insights_periodic_level_ids check (
    (level = 'account')
    or (level = 'campaign' and campaign_id is not null)
    or (level = 'adset'    and campaign_id is not null and adset_id is not null)
    or (level = 'ad'       and campaign_id is not null and adset_id is not null and ad_id is not null)
  )
);

comment on table public.meta_insights_periodic is
  'Agregado por período (sem time_increment). Fonte correta de reach/frequency e dos totais de card. reach NUNCA é obtido somando meta_insights_daily.';

-- presets: uma linha por janela lógica, sobrescrita a cada sync.
create unique index if not exists meta_insights_periodic_preset_uq
  on public.meta_insights_periodic (level, entity_id, period_key, attribution_window)
  where period_key <> 'custom';

-- custom: uma linha por intervalo absoluto (cache).
create unique index if not exists meta_insights_periodic_custom_uq
  on public.meta_insights_periodic (level, entity_id, date_from, date_to, attribution_window)
  where period_key = 'custom';

create index if not exists meta_insights_periodic_client_idx on public.meta_insights_periodic (client_id, level, period_key);
create index if not exists meta_insights_periodic_ad_idx     on public.meta_insights_periodic (ad_id) where ad_id is not null;

create or replace trigger meta_insights_periodic_set_updated_at
  before update on public.meta_insights_periodic
  for each row execute function public.set_updated_at();
create or replace trigger meta_insights_periodic_lock_client
  before update on public.meta_insights_periodic
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 13. meta_sync_runs — auditoria de sincronização
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
create or replace trigger meta_sync_runs_lock_client
  before update on public.meta_sync_runs
  for each row execute function public.meta_lock_client_id();

-- -----------------------------------------------------------------------------
-- 14. Privilégios — anon: nada. authenticated: SÓ leitura das tabelas de
--     dados. meta_connection_secrets: NINGUÉM além de service_role.
-- -----------------------------------------------------------------------------
revoke all on
  public.meta_connections, public.meta_connection_secrets, public.meta_ad_accounts,
  public.meta_campaigns, public.meta_adsets, public.meta_ads, public.meta_creatives,
  public.meta_ad_creatives, public.meta_insights_daily, public.meta_insights_periodic,
  public.meta_sync_runs
  from anon, authenticated, public;

grant select on
  public.meta_connections, public.meta_ad_accounts, public.meta_campaigns,
  public.meta_adsets, public.meta_ads, public.meta_creatives, public.meta_ad_creatives,
  public.meta_insights_daily, public.meta_insights_periodic, public.meta_sync_runs
  to authenticated;

revoke all on function public.meta_lock_client_id() from anon, authenticated, public;

-- meta_connection_secrets: SEM grant para authenticated (fica só com service_role).

-- -----------------------------------------------------------------------------
-- 15. Row Level Security
--     SELECT: quem pode acessar o cliente. meta_connections: só equipe.
--     meta_connection_secrets: RLS ligada, SEM policies => deny-all p/
--     authenticated/anon. service_role tem BYPASSRLS.
--     Nenhuma policy de INSERT/UPDATE/DELETE => o app Next não escreve.
-- -----------------------------------------------------------------------------
alter table public.meta_connections        enable row level security;
alter table public.meta_connection_secrets enable row level security;
alter table public.meta_ad_accounts        enable row level security;
alter table public.meta_campaigns          enable row level security;
alter table public.meta_adsets             enable row level security;
alter table public.meta_ads                enable row level security;
alter table public.meta_creatives          enable row level security;
alter table public.meta_ad_creatives       enable row level security;
alter table public.meta_insights_daily     enable row level security;
alter table public.meta_insights_periodic  enable row level security;
alter table public.meta_sync_runs          enable row level security;

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

drop policy if exists meta_insights_periodic_select on public.meta_insights_periodic;
create policy meta_insights_periodic_select on public.meta_insights_periodic
  for select to authenticated using ( public.can_access_client(client_id) );

drop policy if exists meta_sync_runs_select on public.meta_sync_runs;
create policy meta_sync_runs_select on public.meta_sync_runs
  for select to authenticated using ( public.can_access_client(client_id) );

-- meta_connection_secrets: deliberadamente SEM policy (deny-all).

-- =============================================================================
-- IDEMPOTÊNCIA DA SINCRONIZAÇÃO (guia p/ META 5+)
--   entidades:  insert ... on conflict (<meta_id>) do update set ...
--               (o set-list NUNCA inclui client_id — o trigger meta_lock_client_id
--                barra reatribuição)
--   diário:     on conflict (level, entity_id, date, attribution_window)
--   periódico:  presets  → on conflict (level, entity_id, period_key, attribution_window)
--               custom   → on conflict (level, entity_id, date_from, date_to, attribution_window)
--   ad↔creative: on conflict (ad_id, creative_id) do update set last_seen = now()
--   segredo:    on conflict (connection_id) do update  (rotação de token)
--   Rodar a sync N vezes NÃO duplica linhas.
-- =============================================================================

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop table if exists public.meta_sync_runs         cascade;
--   drop table if exists public.meta_insights_periodic cascade;
--   drop table if exists public.meta_insights_daily    cascade;
--   drop table if exists public.meta_ad_creatives      cascade;
--   drop table if exists public.meta_creatives         cascade;
--   drop table if exists public.meta_ads               cascade;
--   drop table if exists public.meta_adsets            cascade;
--   drop table if exists public.meta_campaigns         cascade;
--   drop table if exists public.meta_ad_accounts       cascade;
--   drop table if exists public.meta_connection_secrets cascade;
--   drop table if exists public.meta_connections       cascade;
--   drop function if exists public.meta_lock_client_id() cascade;
--   drop type if exists public.meta_sync_trigger;
--   drop type if exists public.meta_sync_status;
--   drop type if exists public.meta_insight_level;
--   drop type if exists public.meta_connection_status;
--   drop type if exists public.meta_token_type;
-- =============================================================================
