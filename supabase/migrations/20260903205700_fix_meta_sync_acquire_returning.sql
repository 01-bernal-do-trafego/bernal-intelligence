-- =============================================================================
-- FIX ADITIVO — meta_sync_acquire_client: RETURNING ambíguo (SQLSTATE 42702)
-- -----------------------------------------------------------------------------
-- A migration 20260903193000_meta_auto_sync.sql (JÁ APLICADA — NÃO EDITAR)
-- definiu meta_sync_acquire_client com:
--
--     returning ad_account_ref, connection_id, id
--
-- Os nomes `ad_account_ref` e `connection_id` também são colunas OUT do
-- RETURNS TABLE(...) da própria função -> PostgreSQL levanta
-- `42702 column reference "ad_account_ref" is ambiguous` e o acquire falha
-- para todo cliente (o caminho manual `meta-sync` e o `meta-sync-scheduled`
-- caem em `acquire_failed`).
--
-- Esta migration faz SOMENTE `create or replace function` da mesma função,
-- desambiguando o RETURNING com alias explícito na tabela alvo
-- (`insert into public.meta_sync_runs as msr ... returning msr.<col>`).
--
-- Inalterado: assinatura, RETURNS TABLE, SECURITY DEFINER, SET search_path='',
-- filtros de elegibilidade (via public.meta_eligible_ad_accounts), sync_batch_id
-- compartilhado, INSERT ... SELECT atômico, semântica de sync_already_running /
-- no_eligible_account, grants. Nenhum outro comportamento muda.
-- =============================================================================

create or replace function public.meta_sync_acquire_client(
  p_client_id   uuid,
  p_trigger     public.meta_sync_trigger,
  p_date_from   date,
  p_date_to     date,
  p_created_by  uuid
)
returns table (
  ad_account_ref uuid,
  connection_id  uuid,
  run_id         uuid,
  sync_batch_id  uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid := pg_catalog.gen_random_uuid();  -- qualificado: search_path=''
  v_count integer;
begin
  if p_client_id is null then
    raise exception 'p_client_id é obrigatório';
  end if;

  -- INSERT ... SELECT: um único statement -> atômico. Se QUALQUER conta já
  -- tiver run `running`, o índice único parcial
  -- meta_sync_runs (ad_account_ref) WHERE status='running' faz o statement
  -- inteiro falhar (unique_violation) e a transação reverte por completo —
  -- sem commit parcial.
  --
  -- `as msr` + `returning msr.<col>` elimina a colisão com as colunas OUT
  -- `ad_account_ref` / `connection_id` do RETURNS TABLE (SQLSTATE 42702).
  begin
    return query
    with ins as (
      insert into public.meta_sync_runs as msr (
        client_id, connection_id, ad_account_ref, trigger, status,
        date_from, date_to, created_by, sync_batch_id, started_at
      )
      select
        e.client_id, e.connection_id, e.ad_account_ref,
        coalesce(p_trigger, 'manual'), 'running',
        p_date_from, p_date_to, p_created_by, v_batch, now()
      from public.meta_eligible_ad_accounts e
      where e.client_id = p_client_id
      returning msr.ad_account_ref, msr.connection_id, msr.id
    )
    select i.ad_account_ref, i.connection_id, i.id, v_batch from ins i;
  exception when unique_violation then
    raise exception 'sync_already_running';
  end;

  get diagnostics v_count = row_count;
  if coalesce(v_count, 0) = 0 then
    raise exception 'no_eligible_account';
  end if;
end;
$$;

revoke all on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid)
  to service_role;

comment on function public.meta_sync_acquire_client(uuid, public.meta_sync_trigger, date, date, uuid) is
  'AUTO SYNC V1 — acquire ATÔMICO por cliente. Deriva as contas de '
  'meta_eligible_ad_accounts (não recebe connection_id). Um sync_batch_id '
  'compartilhado; cada run guarda a connection_id da própria conta. Qualquer '
  'conta em `running` -> sync_already_running (rollback total). '
  'RETURNING desambiguado via alias msr (fix 20260903205700).';

-- rollback conceitual (não executar):
--   recriar a versão anterior da função a partir de 20260903193000_meta_auto_sync.sql.
