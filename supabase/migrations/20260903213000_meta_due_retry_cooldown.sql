-- =============================================================================
-- FIX ADITIVO — meta_clients_due_for_sync: cooldown de retry do dispatcher
-- -----------------------------------------------------------------------------
-- A migration 20260903193000_meta_auto_sync.sql (JÁ APLICADA — NÃO EDITAR)
-- definiu meta_clients_due_for_sync(limit, min_age) com uma ÚNICA proteção
-- contra re-disparo: `not exists (run 'running' iniciado < 20 min)`.
--
-- Isso NÃO cobre o cenário de retry agressivo:
--   12:00  cliente due (performance_synced_at antigo)
--   12:00  scheduled sync roda -> cria runs
--   12:01  sync falha (Meta/infra) -> runs viram 'error',
--          performance_synced_at continua antigo (correto: tentativa falha
--          não envelhece dado válido)
--   12:15  dispatcher roda de novo -> ainda due -> re-disparo
--   ... e assim a cada 15 min, indefinidamente.
--
-- Esta migration adiciona um parâmetro `p_retry_cooldown` (default 4h) e um
-- predicado: se HOUVE qualquer meta_sync_runs para o cliente iniciado dentro do
-- cooldown (sucesso OU falha, manual OU cron), o cliente NÃO é auto-selecionado
-- de novo até o cooldown passar. O caminho MANUAL não usa esta função, então
-- o usuário continua podendo sincronizar antes do cooldown.
--
-- Como a assinatura muda (novo parâmetro), é preciso DROP + CREATE. A versão
-- de 2 argumentos só era referenciada pelo bloco `cron.schedule` COMENTADO da
-- migration anterior (não ativo) -> o drop é seguro. A chamada de 2 args
-- continua resolvendo (o 3º parâmetro tem default).
--
-- Inalterado: elegibilidade via public.meta_eligible_ad_accounts (idêntica ao
-- acquire), decisão por IDADE de performance_synced_at (não pelo status do
-- último run), SECURITY DEFINER, SET search_path = '', DISTINCT por cliente,
-- guard de 'running' < 20 min, grants (service_role apenas).
-- =============================================================================

-- índice de apoio ao novo predicado (e à agregação da health view).
create index if not exists meta_sync_runs_client_started_idx
  on public.meta_sync_runs (client_id, started_at desc);

drop function if exists public.meta_clients_due_for_sync(integer, interval);

create or replace function public.meta_clients_due_for_sync(
  p_limit          integer  default 8,
  p_min_age        interval default interval '4 hours',
  p_retry_cooldown interval default interval '4 hours'
)
returns table (client_id uuid)
language sql
security definer
set search_path = ''
as $$
  select distinct on (e.client_id) e.client_id
  from public.meta_eligible_ad_accounts e
  left join public.meta_client_sync_health h on h.client_id = e.client_id
  where (h.performance_synced_at is null
         or h.performance_synced_at < now() - p_min_age)
    -- nada `running` para nenhuma conta deste cliente (janela curta)
    and not exists (
      select 1 from public.meta_sync_runs r
      where r.ad_account_ref = e.ad_account_ref
        and r.status = 'running'
        and r.started_at > now() - interval '20 minutes'
    )
    -- COOLDOWN: já houve tentativa (qualquer status / manual ou cron) recente
    -- para este cliente -> não re-selecionar até o cooldown passar.
    and not exists (
      select 1 from public.meta_sync_runs r
      where r.client_id = e.client_id
        and r.started_at > now() - p_retry_cooldown
    )
  order by e.client_id, h.performance_synced_at asc nulls first
  limit greatest(coalesce(p_limit, 8), 1);
$$;

revoke all on function public.meta_clients_due_for_sync(integer, interval, interval)
  from public, anon, authenticated;
grant execute on function public.meta_clients_due_for_sync(integer, interval, interval)
  to service_role;

comment on function public.meta_clients_due_for_sync(integer, interval, interval) is
  'AUTO SYNC V1 — quem está DUE. Mesma elegibilidade de meta_eligible_ad_accounts '
  '(idêntica ao acquire). Decide por IDADE de performance_synced_at (p_min_age), '
  'NÃO pelo status do último run. p_retry_cooldown (default 4h): se houve '
  'meta_sync_runs para o cliente iniciado dentro do cooldown, não re-seleciona '
  '(evita retry a cada 15 min após falha). Caminho manual não passa por aqui. '
  'Fix 20260903213000.';

-- -----------------------------------------------------------------------------
-- Bloco cron.schedule ATUALIZADO (continua COMENTADO — aplicar esta migration
-- NÃO ativa o Cron).
--
-- Antes de ativar, cadastrar no Vault (hoje só `meta_sync_cron_secret` existe):
--   select vault.create_secret('<project url>',     'project_url');
--   select vault.create_secret('<publishable key>', 'publishable_key');
--   -- `meta_sync_cron_secret` JÁ existe — NÃO recriar nem alterar.
--
-- Duas camadas de auth, distintas e não substituíveis:
--   apikey (publishable_key)  -> libera a chamada no gateway do projeto
--   x-meta-sync-cron-secret   -> autentica o SCHEDULER dentro da função
--                                (comparação em tempo constante)
-- Nenhuma chave literal aqui: URL/apikey/secret vêm todos do Vault.
-- -----------------------------------------------------------------------------
-- select cron.schedule(
--   'meta-auto-sync-dispatch',
--   '*/15 * * * *',
--   $cron$
--   select net.http_post(
--     url     := (select decrypted_secret from vault.decrypted_secrets
--                  where name = 'project_url')
--                || '/functions/v1/meta-sync-scheduled',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', (select decrypted_secret from vault.decrypted_secrets
--                   where name = 'publishable_key'),
--       'x-meta-sync-cron-secret', (select decrypted_secret from vault.decrypted_secrets
--                                    where name = 'meta_sync_cron_secret')
--     ),
--     body    := jsonb_build_object('clientId', d.client_id::text)
--   )
--   from public.meta_clients_due_for_sync(8, interval '4 hours', interval '4 hours') d;
--   $cron$
-- );
--
-- rollback conceitual (não executar):
--   select cron.unschedule('meta-auto-sync-dispatch');
--   drop function if exists public.meta_clients_due_for_sync(integer, interval, interval);
--   -- recriar a versão (integer, interval) a partir de 20260903193000_meta_auto_sync.sql.
