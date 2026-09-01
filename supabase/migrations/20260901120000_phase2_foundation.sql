-- =============================================================================
-- Bernal Intelligence — Fase 2 · Fundação de banco (auth, clientes, RLS)
-- Migration: 20260901120000_phase2_foundation
--
-- ⚠️  NÃO É EXECUTADA AUTOMATICAMENTE. Revisar antes de aplicar.
--     Aplicação futura: Supabase Studio > SQL Editor, ou `supabase db push`.
--     O runner do Supabase (e o SQL Editor) roda o script inteiro em uma
--     transação — não há BEGIN/COMMIT explícito aqui de propósito.
--
-- Escopo desta fundação:
--   • usuários da equipe Bernal e (futuros) usuários clientes  -> public.profiles
--   • múltiplos clientes                                        -> public.clients
--   • isolamento de acesso por cliente                          -> public.client_users + RLS
--   • configuração de dashboard por cliente                     -> public.dashboard_configs
--
-- Nada específico de um único cliente. Meta Ads / Google Ads / TikTok Ads / CRM
-- entram em migrations futuras referenciando public.clients(id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensões
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. Tipos enumerados
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('agency_admin', 'agency_member', 'client_user');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.client_status as enum ('onboarding', 'active', 'paused', 'archived');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tabelas
-- -----------------------------------------------------------------------------

-- 3.1 profiles — 1:1 com auth.users. `role` define o nível de acesso.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null default 'client_user',
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil de cada usuário autenticado. role: agency_admin | agency_member | client_user. Padrão = client_user (menor privilégio).';

create index if not exists profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3.2 clients — id é UUID próprio, nunca derivado do nome.
create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  internal_name text,
  logo_url      text,
  status        public.client_status not null default 'onboarding',
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.clients is
  'Clientes da Bernal. id UUID gerado pelo banco, independente do nome da empresa.';

create index if not exists clients_status_idx     on public.clients (status);
create index if not exists clients_created_at_idx on public.clients (created_at desc);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- 3.3 client_users — allow-list: quais usuários-cliente acessam quais clientes.
create table if not exists public.client_users (
  client_id  uuid not null references public.clients (id) on delete cascade,
  user_id    uuid not null references auth.users (id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

comment on table public.client_users is
  'Associação explícita usuário<->cliente. Um client_user só enxerga os clientes listados aqui para o seu user_id.';

create index if not exists client_users_user_id_idx on public.client_users (user_id);

-- 3.4 dashboard_configs — exatamente uma por cliente (client_id é PK).
create table if not exists public.dashboard_configs (
  client_id     uuid primary key references public.clients (id) on delete cascade,
  result_metric jsonb not null
                  default '{"type":"custom","resultLabel":"Resultados","costLabel":"Custo por resultado"}'::jsonb
                  check (result_metric ? 'type'),
  layout        jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(layout) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.dashboard_configs is
  'Configuração de dashboard por cliente. result_metric = conversão principal (type/resultLabel/costLabel); layout = cards, gráficos, ordem dos componentes e colunas de tabela (preenchido pelo editor futuro).';

create trigger dashboard_configs_set_updated_at
  before update on public.dashboard_configs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Provisionamento automático
-- -----------------------------------------------------------------------------

-- 4.1 Todo novo usuário do Supabase Auth ganha um profile com o MENOR privilégio.
--     O primeiro agency_admin é promovido manualmente depois (ver BOOTSTRAP).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4.2 Todo cliente novo ganha exatamente uma linha em dashboard_configs.
create or replace function public.handle_new_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.dashboard_configs (client_id)
  values (new.id)
  on conflict (client_id) do nothing;
  return new;
end;
$$;

create trigger on_client_created
  after insert on public.clients
  for each row execute function public.handle_new_client();

-- -----------------------------------------------------------------------------
-- 5. Funções de autorização
--    SECURITY DEFINER + search_path travado: rodam como owner e leem
--    profiles/client_users SEM disparar RLS -> evita recursão de policy.
--    Expõem apenas boolean/enum, nunca linhas de dado.
-- -----------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_agency()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('agency_admin', 'agency_member'), false);
$$;

create or replace function public.is_agency_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'agency_admin', false);
$$;

create or replace function public.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_agency()
    or exists (
      select 1
      from public.client_users cu
      where cu.client_id = target_client_id
        and cu.user_id = (select auth.uid())
    );
$$;

-- -----------------------------------------------------------------------------
-- 6. Guarda: somente agency_admin altera profiles.role
--    auth.uid() nulo => contexto confiável (SQL direto / migration) => permitido.
-- -----------------------------------------------------------------------------
create or replace function public.prevent_unauthorized_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not public.is_agency_admin() then
    raise exception 'Somente agency_admin pode alterar o papel (role) de um perfil';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.prevent_unauthorized_role_change();

-- -----------------------------------------------------------------------------
-- 7. Privilégios de tabela / função
--    anon: nenhum acesso.  authenticated: acessa, mas sempre filtrado por RLS.
--    (service_role continua com bypass nativo do Postgres — o app NUNCA o usa.)
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.clients, public.client_users, public.dashboard_configs
  from anon, public;

grant select, insert, update, delete
  on public.profiles, public.clients, public.client_users, public.dashboard_configs
  to authenticated;

revoke all on function
  public.current_app_role(),
  public.is_agency(),
  public.is_agency_admin(),
  public.can_access_client(uuid)
  from anon, public;

grant execute on function
  public.current_app_role(),
  public.is_agency(),
  public.is_agency_admin(),
  public.can_access_client(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.clients           enable row level security;
alter table public.client_users      enable row level security;
alter table public.dashboard_configs enable row level security;

-- 8.1 profiles ---------------------------------------------------------------
-- Ler: o próprio perfil, ou qualquer perfil se for equipe Bernal.
create policy profiles_select_self_or_agency
  on public.profiles for select
  to authenticated
  using ( id = (select auth.uid()) or public.is_agency() );

-- Atualizar o próprio perfil (troca de role é barrada pelo trigger).
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using ( id = (select auth.uid()) )
  with check ( id = (select auth.uid()) );

-- agency_admin administra qualquer perfil (inclusive definir role).
create policy profiles_admin_all
  on public.profiles for all
  to authenticated
  using ( public.is_agency_admin() )
  with check ( public.is_agency_admin() );

-- 8.2 clients --------------------------------------------------------------
-- Ler: equipe Bernal vê todos; client_user vê só os que lhe foram associados.
create policy clients_select_accessible
  on public.clients for select
  to authenticated
  using ( public.can_access_client(id) );

-- Criar: qualquer membro da equipe (agency_admin ou agency_member).
create policy clients_insert_agency
  on public.clients for insert
  to authenticated
  with check ( public.is_agency() );

-- Editar: qualquer membro da equipe.
create policy clients_update_agency
  on public.clients for update
  to authenticated
  using ( public.is_agency() )
  with check ( public.is_agency() );

-- Excluir: somente agency_admin (o fluxo normal é arquivar via status).
create policy clients_delete_admin
  on public.clients for delete
  to authenticated
  using ( public.is_agency_admin() );

-- 8.3 client_users ------------------------------------------------------------
-- Ler: equipe Bernal vê tudo; um client_user vê as próprias associações.
create policy client_users_select_self_or_agency
  on public.client_users for select
  to authenticated
  using ( public.is_agency() or user_id = (select auth.uid()) );

-- Gerenciar quem acessa o quê: somente agency_admin.
create policy client_users_admin_write
  on public.client_users for all
  to authenticated
  using ( public.is_agency_admin() )
  with check ( public.is_agency_admin() );

-- 8.4 dashboard_configs ----------------------------------------------------
-- Ler: mesma visibilidade do cliente correspondente.
create policy dashboard_configs_select_accessible
  on public.dashboard_configs for select
  to authenticated
  using ( public.can_access_client(client_id) );

-- Criar/editar a configuração: equipe Bernal. client_user é somente leitura.
create policy dashboard_configs_insert_agency
  on public.dashboard_configs for insert
  to authenticated
  with check ( public.is_agency() );

create policy dashboard_configs_update_agency
  on public.dashboard_configs for update
  to authenticated
  using ( public.is_agency() )
  with check ( public.is_agency() );

create policy dashboard_configs_delete_admin
  on public.dashboard_configs for delete
  to authenticated
  using ( public.is_agency_admin() );

-- =============================================================================
-- BOOTSTRAP — passos manuais, executados SEPARADAMENTE quando autorizado:
--
--   1. Supabase Studio > Authentication > Users > "Add user"
--      (com "Auto Confirm User"). O trigger cria o profile como 'client_user'.
--
--   2. Promover o primeiro administrador:
--        update public.profiles
--        set role = 'agency_admin'
--        where id = (select id from auth.users where email = 'ADMIN@DOMINIO');
--
--   3. Supabase Studio > Authentication > Providers > Email:
--      desligar "Enable sign-ups"  (sem cadastro público na fase atual).
--
--   4. Associar um usuário cliente a um cliente:
--        insert into public.client_users (client_id, user_id)
--        values ('<uuid-do-cliente>', '<uuid-do-usuario>');
-- =============================================================================

-- =============================================================================
-- ROLLBACK MANUAL (NÃO executado por esta migration):
--
--   drop table if exists public.dashboard_configs cascade;
--   drop table if exists public.client_users      cascade;
--   drop table if exists public.clients           cascade;
--   drop table if exists public.profiles          cascade;
--   drop function if exists public.can_access_client(uuid);
--   drop function if exists public.is_agency_admin();
--   drop function if exists public.is_agency();
--   drop function if exists public.current_app_role();
--   drop function if exists public.handle_new_user()                 cascade;
--   drop function if exists public.handle_new_client()               cascade;
--   drop function if exists public.prevent_unauthorized_role_change() cascade;
--   drop function if exists public.set_updated_at()                  cascade;
--   drop type if exists public.client_status;
--   drop type if exists public.user_role;
-- =============================================================================
