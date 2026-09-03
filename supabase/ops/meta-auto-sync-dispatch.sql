-- =============================================================================
-- OPERACIONAL (NÃO é migration) — AUTO SYNC V1: job pg_cron do dispatcher
-- -----------------------------------------------------------------------------
-- Rodar manualmente contra o projeto para (re)ativar o dispatcher. Idempotente:
-- remove o job anterior (se houver) e recria.
--
-- Pré-requisitos NO VAULT (nomes — valores nunca versionados/impressos):
--   project_url            -> ex. https://<ref>.supabase.co   (SEM barra final)
--   publishable_key        -> publishable/anon key do projeto (NÃO service_role)
--   meta_sync_cron_secret  -> secret dedicado do scheduler (já existe)
--
-- Duas camadas de auth, distintas:
--   apikey (publishable_key)  -> libera a chamada no gateway do projeto
--   x-meta-sync-cron-secret   -> autentica o scheduler DENTRO da função
--                                (comparação em tempo constante)
--
-- timeout_milliseconds = 140000:
--   > tempos reais observados (~31s incremental, ~86s primeiro FULL)
--   < request idle timeout de 150s da Edge Function
--   != default de 2000 ms do pg_net (que abortaria todo sync)
--
-- Cadência: dispatcher a cada 15 min; cada cliente só entra quando
-- performance_synced_at está > 4h (p_min_age) E não houve tentativa nos
-- últimos 4h (p_retry_cooldown). Batch de no máximo 8 clientes por tick.
-- =============================================================================

-- 1. remove o job anterior, se existir (sem erro quando não existe)
select cron.unschedule(jobid)
from cron.job
where jobname = 'meta-auto-sync-dispatch';

-- 2. (re)cria o job
select cron.schedule(
  'meta-auto-sync-dispatch',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets
                 where name = 'project_url')
               || '/functions/v1/meta-sync-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                  where name = 'publishable_key'),
      'x-meta-sync-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                   where name = 'meta_sync_cron_secret')
    ),
    body    := jsonb_build_object('clientId', d.client_id::text),
    timeout_milliseconds := 140000
  )
  from public.meta_clients_due_for_sync(8, interval '4 hours', interval '4 hours') d;
  $cron$
);

-- 3. conferência (read-only)
select jobid, jobname, schedule, active
from cron.job
where jobname = 'meta-auto-sync-dispatch';

-- -----------------------------------------------------------------------------
-- desativar (rollback operacional):
--   select cron.unschedule(jobid) from cron.job where jobname = 'meta-auto-sync-dispatch';
-- -----------------------------------------------------------------------------
