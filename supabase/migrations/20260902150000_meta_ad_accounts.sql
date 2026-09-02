-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 3 (descoberta + vínculo de contas)
-- Migration: 20260902150000_meta_ad_accounts
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar. Idempotente (create or replace).
--
-- Depende da META 1 (20260902130000): public.meta_ad_accounts, public.meta_connections.
-- NÃO altera nenhuma tabela — só adiciona 2 funções.
--
-- meta_ad_accounts já distingue:
--   is_linked = false  -> conta DESCOBERTA
--   is_linked = true   -> conta SELECIONADA para o cliente
-- e o índice único global `meta_ad_accounts_linked_global_uq (ad_account_id)
-- where is_linked` garante: uma conta linkada pertence a NO MÁXIMO UM cliente.
-- Estas funções reproduzem essa regra para dar erro amigável antes do INSERT.
--
-- Só a Edge Function `meta-ad-accounts` (service_role) executa. A autorização
-- de usuário (sessão de agência + can_access_client) é feita NA função, antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. meta_upsert_ad_accounts — grava/atualiza as contas descobertas.
--    Idempotente: on conflict (connection_id, ad_account_id). NUNCA toca
--    is_linked / sync_enabled / client_id. Rodar de novo não duplica.
-- -----------------------------------------------------------------------------
create or replace function public.meta_upsert_ad_accounts(
  p_connection_id uuid,
  p_client_id     uuid,
  p_accounts      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_connection_id is null or p_client_id is null then
    raise exception 'p_connection_id e p_client_id são obrigatórios';
  end if;

  if not exists (
    select 1 from public.meta_connections
    where id = p_connection_id and client_id = p_client_id
  ) then
    raise exception 'conexão % não pertence ao cliente %', p_connection_id, p_client_id;
  end if;

  insert into public.meta_ad_accounts (
    client_id, connection_id, ad_account_id, account_name, account_status,
    currency, timezone_name, timezone_offset_utc, business_id, business_name
  )
  select
    p_client_id,
    p_connection_id,
    a->>'adAccountId',
    nullif(a->>'name', ''),
    nullif(a->>'accountStatus', '')::int,
    nullif(a->>'currency', ''),
    nullif(a->>'timezoneName', ''),
    nullif(a->>'timezoneOffsetUtc', '')::int,
    nullif(a->>'businessId', ''),
    nullif(a->>'businessName', '')
  from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) as a
  where a->>'adAccountId' ~ '^act_[0-9]+$'
  on conflict (connection_id, ad_account_id) do update set
    account_name        = excluded.account_name,
    account_status      = excluded.account_status,
    currency            = excluded.currency,
    timezone_name       = excluded.timezone_name,
    timezone_offset_utc = excluded.timezone_offset_utc,
    business_id         = excluded.business_id,
    business_name       = excluded.business_name,
    updated_at          = now();

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  into v_rows
  from (
    select ad_account_id, account_name, account_status, currency,
           timezone_name, timezone_offset_utc, business_id, business_name,
           is_linked, sync_enabled
    from public.meta_ad_accounts
    where connection_id = p_connection_id and client_id = p_client_id
    order by account_name nulls last, ad_account_id
  ) x;

  return v_rows;
end;
$$;

comment on function public.meta_upsert_ad_accounts(uuid, uuid, jsonb) is
  'META 3 — upsert idempotente das contas descobertas na conexão. Não altera '
  'is_linked/sync_enabled/client_id. Só service_role (Edge Function meta-ad-accounts).';

-- -----------------------------------------------------------------------------
-- 2. meta_set_linked_accounts — define quais contas ficam vinculadas ao cliente.
--    is_linked = (ad_account_id ∈ p_link_ids), para as linhas da conexão/cliente.
--    Barra id inexistente na descoberta e id já linkado a OUTRO cliente.
-- -----------------------------------------------------------------------------
create or replace function public.meta_set_linked_accounts(
  p_connection_id uuid,
  p_client_id     uuid,
  p_link_ids      text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     text[] := coalesce(p_link_ids, '{}');
  v_bad     text;
  v_rows    jsonb;
begin
  if p_connection_id is null or p_client_id is null then
    raise exception 'p_connection_id e p_client_id são obrigatórios';
  end if;

  if not exists (
    select 1 from public.meta_connections
    where id = p_connection_id and client_id = p_client_id
  ) then
    raise exception 'conexão % não pertence ao cliente %', p_connection_id, p_client_id;
  end if;

  -- todo id pedido precisa existir na descoberta deste cliente/conexão
  select string_agg(x, ', ') into v_bad
  from unnest(v_ids) as x
  where x not in (
    select ad_account_id from public.meta_ad_accounts
    where connection_id = p_connection_id and client_id = p_client_id
  );
  if v_bad is not null then
    raise exception 'contas não descobertas para este cliente: %', v_bad;
  end if;

  -- nenhuma pode já estar linkada a OUTRO cliente
  select string_agg(ad_account_id, ', ') into v_bad
  from public.meta_ad_accounts
  where ad_account_id = any(v_ids) and is_linked and client_id <> p_client_id;
  if v_bad is not null then
    raise exception 'account_linked_elsewhere: %', v_bad;
  end if;

  begin
    update public.meta_ad_accounts
    set is_linked    = (ad_account_id = any(v_ids)),
        sync_enabled = case when (ad_account_id = any(v_ids)) then sync_enabled else false end
    where connection_id = p_connection_id and client_id = p_client_id;
  exception when unique_violation then
    -- corrida: alguém linkou a conta a outro cliente entre a checagem e o update
    raise exception 'account_linked_elsewhere: corrida detectada';
  end;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  into v_rows
  from (
    select ad_account_id, account_name, account_status, currency,
           timezone_name, timezone_offset_utc, business_id, business_name,
           is_linked, sync_enabled
    from public.meta_ad_accounts
    where connection_id = p_connection_id and client_id = p_client_id
    order by account_name nulls last, ad_account_id
  ) x;

  return v_rows;
end;
$$;

comment on function public.meta_set_linked_accounts(uuid, uuid, text[]) is
  'META 3 — define is_linked das contas da conexão/cliente. Barra conta de '
  'outro cliente (app + índice único global). Só service_role.';

-- -----------------------------------------------------------------------------
-- 3. Privilégios — só service_role executa.
-- -----------------------------------------------------------------------------
revoke all on function public.meta_upsert_ad_accounts(uuid, uuid, jsonb)
  from anon, authenticated, public;
grant execute on function public.meta_upsert_ad_accounts(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.meta_set_linked_accounts(uuid, uuid, text[])
  from anon, authenticated, public;
grant execute on function public.meta_set_linked_accounts(uuid, uuid, text[])
  to service_role;

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop function if exists public.meta_set_linked_accounts(uuid, uuid, text[]);
--   drop function if exists public.meta_upsert_ad_accounts(uuid, uuid, jsonb);
-- =============================================================================
