-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 2 (OAuth)
-- Migration: 20260902140000_meta_oauth
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (SQL Editor ou `supabase db push`).
--     Idempotente (create or replace).
--
-- Depende da META 1 (20260902130000_meta_integration): tabelas
-- public.meta_connections, public.meta_connection_secrets e os tipos
-- public.meta_token_type / public.meta_connection_status.
--
-- O QUE ADICIONA
--   Uma função SECURITY DEFINER que grava/rotaciona a conexão Meta de um
--   cliente e o token cifrado NUMA ÚNICA TRANSAÇÃO. Chamada só pela Edge
--   Function `meta-oauth-exchange` (service_role). A função NÃO confere
--   autorização — quem chama (callback do Next + a própria Edge Function) já
--   validou sessão de agência e acesso ao cliente.
--
--   O token em claro nunca chega aqui: recebemos os 3 componentes do
--   AES-256-GCM (cipher / iv / tag) já em base64, e só fazemos decode -> bytea.
-- =============================================================================

create or replace function public.meta_oauth_upsert_connection(
  p_client_id               uuid,
  p_token_type              public.meta_token_type,
  p_meta_user_id            text,
  p_meta_business_id        text,
  p_scopes                  text[],
  p_status                  public.meta_connection_status,
  p_expires_at              timestamptz,
  p_data_access_expires_at  timestamptz,
  p_created_by              uuid,
  p_token_cipher_b64        text,
  p_token_iv_b64            text,
  p_token_tag_b64           text,
  p_key_version             smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
begin
  if p_client_id is null then
    raise exception 'p_client_id é obrigatório';
  end if;
  if coalesce(p_token_cipher_b64, '') = ''
     or coalesce(p_token_iv_b64, '') = ''
     or coalesce(p_token_tag_b64, '') = '' then
    raise exception 'componentes do token cifrado ausentes';
  end if;

  -- 1 conexão "corrente" por cliente: reaproveita a mais recente
  -- (rotação de token = mesmo registro; o histórico de contas é preservado
  --  porque meta_ad_accounts.connection_id é "on delete set null").
  select id into v_connection_id
  from public.meta_connections
  where client_id = p_client_id
  order by created_at desc
  limit 1;

  if v_connection_id is null then
    insert into public.meta_connections (
      client_id, token_type, meta_user_id, meta_business_id, scopes,
      status, status_reason, expires_at, data_access_expires_at,
      last_verified_at, last_refresh_at, last_error, has_secret, created_by
    ) values (
      p_client_id, p_token_type, p_meta_user_id, p_meta_business_id,
      coalesce(p_scopes, '{}'),
      p_status, null, p_expires_at, p_data_access_expires_at,
      now(), now(), null, true, p_created_by
    )
    returning id into v_connection_id;
  else
    -- não toca em client_id (o trigger meta_connections_lock_client barraria).
    update public.meta_connections set
      token_type             = p_token_type,
      meta_user_id           = p_meta_user_id,
      meta_business_id       = p_meta_business_id,
      scopes                 = coalesce(p_scopes, '{}'),
      status                 = p_status,
      status_reason          = null,
      expires_at             = p_expires_at,
      data_access_expires_at = p_data_access_expires_at,
      last_verified_at       = now(),
      last_refresh_at        = now(),
      last_error             = null,
      has_secret             = true
    where id = v_connection_id;
  end if;

  insert into public.meta_connection_secrets (
    connection_id, token_cipher, token_iv, token_tag, key_version
  ) values (
    v_connection_id,
    decode(p_token_cipher_b64, 'base64'),
    decode(p_token_iv_b64, 'base64'),
    decode(p_token_tag_b64, 'base64'),
    coalesce(p_key_version, 1)
  )
  on conflict (connection_id) do update set
    token_cipher = excluded.token_cipher,
    token_iv     = excluded.token_iv,
    token_tag    = excluded.token_tag,
    key_version  = excluded.key_version,
    updated_at   = now();

  return v_connection_id;
end;
$$;

comment on function public.meta_oauth_upsert_connection(
  uuid, public.meta_token_type, text, text, text[], public.meta_connection_status,
  timestamptz, timestamptz, uuid, text, text, text, smallint
) is
  'META 2 — grava/rotaciona a conexão Meta + token cifrado numa transação. '
  'SECURITY DEFINER: só a Edge Function meta-oauth-exchange (service_role) chama. '
  'Não confere autorização (o chamador já validou sessão/cliente).';

-- Ninguém além de service_role pode executar.
revoke all on function public.meta_oauth_upsert_connection(
  uuid, public.meta_token_type, text, text, text[], public.meta_connection_status,
  timestamptz, timestamptz, uuid, text, text, text, smallint
) from anon, authenticated, public;

grant execute on function public.meta_oauth_upsert_connection(
  uuid, public.meta_token_type, text, text, text[], public.meta_connection_status,
  timestamptz, timestamptz, uuid, text, text, text, smallint
) to service_role;

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop function if exists public.meta_oauth_upsert_connection(
--     uuid, public.meta_token_type, text, text, text[], public.meta_connection_status,
--     timestamptz, timestamptz, uuid, text, text, text, smallint);
-- =============================================================================
