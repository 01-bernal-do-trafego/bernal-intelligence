-- =============================================================================
-- Bernal Intelligence — MVP Comercial 1.0 · Client Dashboard Share Link
-- Migration: 20260914120000_dashboard_share_links
--
-- ⚠️  NÃO É EXECUTADA AUTOMATICAMENTE. Revisar antes de aplicar.
--     Aplicação futura: Supabase Studio > SQL Editor, ou `supabase db push`.
--     Idempotente: create ... if not exists / drop policy if exists.
--
-- Pré-requisito: `20260901120000_phase2_foundation.sql` já aplicada (usa
-- public.clients, public.is_agency(), public.can_access_client(uuid),
-- public.set_updated_at()).
--
-- Escopo: link individual, revogável, SOMENTE LEITURA, por cliente
-- (AGENTS.md / MVP COMERCIAL 1.0 — Client Dashboard Share Link).
--
-- Token opaco criptograficamente aleatório (256 bits, base64url, 43 chars)
-- gerado e validado no app (Next.js server-side, `lib/share-token.ts`).
-- Esta tabela guarda SOMENTE o HASH SHA-256 (hex) do token — o token em
-- claro NUNCA é persistido; é devolvido 1x ao admin na resposta da Server
-- Action de gerar/regenerar e descartado depois disso ("revelar uma vez",
-- mesmo padrão de chave de API do GitHub/Stripe).
--
-- 1 linha por cliente — client_id é a PK, MESMO padrão de
-- public.dashboard_configs. Gerar/regenerar é sempre um UPSERT no mesmo
-- registro: por construção NUNCA existem dois links ativos para o mesmo
-- cliente (não depende de lock/constraint adicional para isso).
--
-- A leitura pública (`/share/<token>`) NÃO passa por RLS — usa o client
-- `service_role` (`supabase/service.ts`), só depois do hash do token bater
-- aqui com `is_active = true` (ver `server/share-link.ts#resolveShareToken`).
-- Esta migration não concede NADA ao role `anon`.
-- =============================================================================

create table if not exists public.dashboard_share_links (
  client_id        uuid primary key references public.clients (id) on delete cascade,
  token_hash       text not null,
  is_active        boolean not null default false,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz
);

comment on table public.dashboard_share_links is
  'Link somente-leitura compartilhável do dashboard de um cliente. token_hash = SHA-256 hex do token opaco (o token em claro nunca é persistido — só devolvido 1x ao admin no momento de gerar/regenerar). 1 linha por cliente; gerar/regenerar é upsert no mesmo registro, então nunca há dois links ativos para o mesmo cliente.';

comment on column public.dashboard_share_links.token_hash is
  'SHA-256 hex (64 chars) do token opaco. Nunca o token em claro.';
comment on column public.dashboard_share_links.is_active is
  'false = link desativado (a linha permanece, com o hash antigo, só para não recriar a PK; "regenerar" sobrescreve token_hash e volta para true).';
comment on column public.dashboard_share_links.last_accessed_at is
  'Último acesso público bem-sucedido via /share/<token> (best-effort, atualizado pelo service_role). Não exibido na UI nesta fase — não é um dashboard de analytics.';

-- Índice único no hash: mesmo com SHA-256 (colisão praticamente impossível),
-- garante no banco que dois clientes nunca compartilhem o mesmo token_hash.
create unique index if not exists dashboard_share_links_token_hash_key
  on public.dashboard_share_links (token_hash);

create or replace trigger dashboard_share_links_set_updated_at
  before update on public.dashboard_share_links
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privilégios — mesma regra de public.dashboard_configs: anon SEM NENHUM
-- acesso (nem select); authenticated sempre filtrado por RLS abaixo.
-- (service_role continua com bypass nativo do Postgres — usado só pela rota
-- pública /share/<token>, nunca pela UI administrativa.)
-- -----------------------------------------------------------------------------
revoke all on public.dashboard_share_links from anon, public;

grant select, insert, update on public.dashboard_share_links to authenticated;

alter table public.dashboard_share_links enable row level security;

-- Ler/gerenciar: somente equipe Bernal (agency_admin/agency_member), e só
-- para clientes que ela acessa (mesma função can_access_client já usada por
-- clients/dashboard_configs). client_user NUNCA vê esta tabela — o acesso de
-- um usuário-cliente ao próprio dashboard é por login, não por este link.
drop policy if exists dashboard_share_links_select_agency on public.dashboard_share_links;
create policy dashboard_share_links_select_agency
  on public.dashboard_share_links for select
  to authenticated
  using ( public.is_agency() and public.can_access_client(client_id) );

drop policy if exists dashboard_share_links_insert_agency on public.dashboard_share_links;
create policy dashboard_share_links_insert_agency
  on public.dashboard_share_links for insert
  to authenticated
  with check ( public.is_agency() and public.can_access_client(client_id) );

drop policy if exists dashboard_share_links_update_agency on public.dashboard_share_links;
create policy dashboard_share_links_update_agency
  on public.dashboard_share_links for update
  to authenticated
  using ( public.is_agency() and public.can_access_client(client_id) )
  with check ( public.is_agency() and public.can_access_client(client_id) );

-- Sem policy de DELETE: "desativar" é sempre UPDATE (is_active = false),
-- nunca DELETE — mantém client_id como PK estável (1 linha por cliente).
-- Sem NENHUMA policy para o role anon: a leitura pública do link passa pelo
-- service_role fora da RLS (ver supabase/service.ts), nunca por uma policy
-- de anon aqui — evita qualquer superfície de RLS que dependa de header/GUC
-- customizado só para este fluxo.

-- =============================================================================
-- ROLLBACK MANUAL (NÃO executado por esta migration):
--
--   drop table if exists public.dashboard_share_links cascade;
-- =============================================================================
