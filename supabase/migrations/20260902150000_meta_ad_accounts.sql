-- =============================================================================
-- Bernal Intelligence — Integração Meta Ads · META 3 (descoberta + vínculo de contas)
-- Migration: 20260902150000_meta_ad_accounts
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar. Idempotente (create or replace,
--     drop column if exists).
--
-- Depende da META 1 (20260902130000): public.meta_ad_accounts, public.meta_connections.
--
-- MUDANÇAS NESTA MIGRATION
--   (a) REMOVE a coluna `meta_ad_accounts.timezone_offset_utc` (era `integer` e
--       o offset UTC não cabe em inteiro — fusos como Ásia/Calcutá = +5:30,
--       Nepal = +5:45 — e ainda muda com horário de verão). A fonte correta é
--       `timezone_name` (IANA); o offset, quando preciso, é derivado sob demanda
--       no app (lib/meta/timezone.ts). A META 1 já foi aplicada com a coluna;
--       por isso o DROP fica aqui (o arquivo da META 1 é mantido como histórico).
--   (b) meta_upsert_ad_accounts — upsert idempotente da descoberta.
--   (c) meta_set_linked_accounts — define is_linked, com TRANSFERÊNCIA ATÔMICA
--       da conta entre conexões do MESMO cliente (reconexão) e bloqueio de
--       conta de OUTRO cliente.
--
-- meta_ad_accounts já distingue is_linked = false (DESCOBERTA) de true
-- (SELECIONADA). O índice único global `meta_ad_accounts_linked_global_uq
-- (ad_account_id) where is_linked` garante: uma conta linkada pertence a NO
-- MÁXIMO UMA linha em todo o sistema.
--
-- Só a Edge Function `meta-ad-accounts` (service_role) executa as funções. A
-- autorização de usuário (sessão de agência + can_access_client) é feita NA
-- função, antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) remove o offset persistido (0 linhas hoje; seguro)
-- -----------------------------------------------------------------------------
alter table public.meta_ad_accounts drop column if exists timezone_offset_utc;

-- -----------------------------------------------------------------------------
-- (b) meta_upsert_ad_accounts — grava/atualiza as contas descobertas.
--     Idempotente: on conflict (connection_id, ad_account_id). NUNCA toca
--     is_linked / sync_enabled / client_id. Rodar de novo não duplica.
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
    currency, timezone_name, business_id, business_name
  )
  select
    p_client_id,
    p_connection_id,
    a->>'adAccountId',
    nullif(a->>'name', ''),
    nullif(a->>'accountStatus', '')::int,
    nullif(a->>'currency', ''),
    nullif(a->>'timezoneName', ''),
    nullif(a->>'businessId', ''),
    nullif(a->>'businessName', '')
  from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) as a
  where a->>'adAccountId' ~ '^act_[0-9]+$'
  on conflict (connection_id, ad_account_id) do update set
    account_name   = excluded.account_name,
    account_status = excluded.account_status,
    currency       = excluded.currency,
    timezone_name  = excluded.timezone_name,
    business_id    = excluded.business_id,
    business_name  = excluded.business_name,
    updated_at     = now();

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  into v_rows
  from (
    select ad_account_id, account_name, account_status, currency,
           timezone_name, business_id, business_name, is_linked, sync_enabled
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
-- (c) meta_set_linked_accounts — define quais contas ficam vinculadas ao cliente.
--
--     Numa ÚNICA transação (corpo da função plpgsql):
--       1. valida que a conexão é do cliente;
--       2. valida que todo id pedido existe na descoberta desta conexão;
--       3. BLOQUEIA id linkado a OUTRO cliente  -> account_linked_elsewhere;
--       4. TRANSFERE: para id linkado ao MESMO cliente por uma conexão
--          DIFERENTE (reconexão), solta o vínculo antigo (is_linked=false);
--       5. aplica is_linked = (id ∈ lista) nas linhas desta conexão/cliente.
--
--     Ordem 4 -> 5 garante que, quando a linha nova vira is_linked=true, a
--     antiga já está false: o índice único global nunca vê duas linhas true
--     para o mesmo ad_account_id. Se ainda assim colidir (corrida com outro
--     cliente), unique_violation -> account_linked_elsewhere e a transação
--     inteira faz rollback (nada é aplicado).
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
  v_ids  text[] := coalesce(p_link_ids, '{}');
  v_bad  text;
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

  -- 2. todo id pedido tem que existir na descoberta desta conexão/cliente
  select string_agg(x, ', ') into v_bad
  from unnest(v_ids) as x
  where x not in (
    select ad_account_id from public.meta_ad_accounts
    where connection_id = p_connection_id and client_id = p_client_id
  );
  if v_bad is not null then
    raise exception 'contas não descobertas para este cliente: %', v_bad;
  end if;

  -- 3. nenhuma pode já estar linkada a OUTRO cliente
  select string_agg(distinct ad_account_id, ', ') into v_bad
  from public.meta_ad_accounts
  where ad_account_id = any(v_ids) and is_linked and client_id <> p_client_id;
  if v_bad is not null then
    raise exception 'account_linked_elsewhere: %', v_bad;
  end if;

  begin
    -- 4. transferência: solta o vínculo em conexões ANTIGAS do MESMO cliente
    --    (connection_id diferente, inclusive NULL de conexão removida).
    update public.meta_ad_accounts
    set is_linked = false, sync_enabled = false
    where client_id = p_client_id
      and connection_id is distinct from p_connection_id
      and ad_account_id = any(v_ids)
      and is_linked;

    -- 5. aplica o estado desejado nas linhas DESTA conexão/cliente
    update public.meta_ad_accounts
    set is_linked    = (ad_account_id = any(v_ids)),
        sync_enabled = case when (ad_account_id = any(v_ids)) then sync_enabled else false end
    where connection_id = p_connection_id and client_id = p_client_id;
  exception when unique_violation then
    raise exception 'account_linked_elsewhere: corrida detectada';
  end;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  into v_rows
  from (
    select ad_account_id, account_name, account_status, currency,
           timezone_name, business_id, business_name, is_linked, sync_enabled
    from public.meta_ad_accounts
    where connection_id = p_connection_id and client_id = p_client_id
    order by account_name nulls last, ad_account_id
  ) x;

  return v_rows;
end;
$$;

comment on function public.meta_set_linked_accounts(uuid, uuid, text[]) is
  'META 3 — define is_linked das contas da conexão/cliente. Transfere a conta '
  'entre conexões do mesmo cliente (reconexão) na mesma transação; barra conta '
  'de outro cliente (app + índice único global). Só service_role.';

-- -----------------------------------------------------------------------------
-- (d) Privilégios — só service_role executa.
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
--   alter table public.meta_ad_accounts add column if not exists timezone_offset_utc integer;
-- =============================================================================
