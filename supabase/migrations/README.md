# Migrations — Bernal Intelligence

Migrations SQL versionadas do banco (Supabase / PostgreSQL).

## Fonte da verdade

**Os arquivos `.sql` desta pasta são a fonte da verdade do schema.** Um banco
vazio + estas migrations aplicadas na ordem cronológica do prefixo de timestamp
produzem o schema correto e completo. Todas já foram validadas no ambiente de
desenvolvimento (`Bernal Intelligence Dev`) em operação real.

> **Nota sobre o tracking no Dev:** no ambiente de desenvolvimento várias
> migrations foram aplicadas via `supabase db query` (Management API), que **não**
> registra em `supabase_migrations.schema_migrations`. Portanto, no Dev, essa
> tabela de tracking **não** é a referência histórica — a referência são os
> arquivos abaixo. Em produção o fluxo é diferente: usar **somente**
> `supabase db push`, que registra o tracking corretamente.

## Migrations (ordem cronológica)

| # | Arquivo | Descrição | Validada no Dev |
| --- | --- | --- | --- |
| 1 | `20260901120000_phase2_foundation.sql` | Fundação Fase 2: enums `user_role` / `client_status`; tabelas `profiles`, `clients`, `client_users`, `dashboard_configs`; funções de RBAC (`current_app_role`, `is_agency`, `is_agency_admin`, `can_access_client`) e triggers (`handle_new_user`, `handle_new_client`, `set_updated_at`, `prevent_unauthorized_role_change`); RLS nas 4 tabelas. Só schema — bootstrap manual no rodapé do arquivo. | Sim |
| 2 | `20260902130000_meta_integration.sql` | META 1 — enums `meta_*`; 11 tabelas `meta_*` (`meta_connections`, `meta_connection_secrets`, `meta_ad_accounts`, `meta_campaigns`, `meta_adsets`, `meta_ads`, `meta_creatives`, `meta_ad_creatives`, `meta_insights_daily`, `meta_insights_periodic`, `meta_sync_runs`); índices; RLS. | Sim |
| 3 | `20260902140000_meta_oauth.sql` | META 2 — RPC `meta_oauth_upsert_connection` (grava conexão + token cifrado numa transação atômica). | Sim |
| 4 | `20260902150000_meta_ad_accounts.sql` | META 3 — `drop column meta_ad_accounts.timezone_offset_utc`; RPCs `meta_upsert_ad_accounts` / `meta_set_linked_accounts` (descoberta, vínculo e transferência de contas em reconexão). | Sim |
| 5 | `20260902160000_meta_sync.sql` | META 5 (1ª sincronização real) — índice único parcial `meta_sync_runs (ad_account_ref) where status='running'`; RPCs `meta_sync_acquire` / `meta_sync_release` / `meta_upsert_insights_periodic`; substitui os índices únicos de `meta_insights_periodic` por `_interval_uq` + `_preset_lookup`. | Sim |
| 6 | `20260902170000_meta_conversions.sql` | Conversões reais V1 — `meta_upsert_insights_periodic` passa a gravar `actions` / `action_values` / `raw_actions` / `raw_action_values`; `attribution_window` default `unified_attribution`; `UPDATE` de renomeação da atribuição legada (**no-op em banco vazio** — 0 linhas). Sem DDL de tabela. | Sim |
| 7 | `20260902190000_meta_creatives_detail.sql` | Criativos reais V1 — colunas `image_hash` / `object_story_id` / `effective_object_story_id` / `object_story_spec` em `meta_creatives` + 2 índices parciais. Aditivo, 0 linhas afetadas (colunas nascem NULL, o meta-sync preenche). | Sim |
| 8 | `20260903193000_meta_auto_sync.sql` | Auto Sync V1 + creative sync incremental — `create extension if not exists pg_cron` / `pg_net` / `supabase_vault`; `meta_sync_runs.sync_batch_id`; `meta_creatives.details_fetched_at`; view `meta_eligible_ad_accounts`; funções `meta_sync_gc_stale` / `meta_sync_acquire_client` / `meta_essential_stages` / `meta_clients_due_for_sync` (2 args) / `meta_auto_sync_enabled`; view `meta_client_sync_health`. **O `cron.schedule` fica COMENTADO** — aplicar esta migration ≠ ligar o cron. | Sim |
| 9 | `20260903205700_fix_meta_sync_acquire_returning.sql` | Fix aditivo — `create or replace meta_sync_acquire_client` com alias explícito no `RETURNING` (corrige `SQLSTATE 42702`, referência ambígua a `ad_account_ref`). | Sim |
| 10 | `20260903213000_meta_due_retry_cooldown.sql` | Fix aditivo — índice `meta_sync_runs_client_started_idx`; `drop` + `create` de `meta_clients_due_for_sync` na versão de 3 args, com `p_retry_cooldown interval default '4 hours'` (cooldown de retry do dispatcher). Atualiza o template comentado do `cron.schedule`. | Sim |
| 11 | `20260903214500_fix_creatives_health_incremental.sql` | Fix aditivo — `create or replace view meta_client_sync_health` (`security_invoker = true`) corrigindo a semântica de `creatives_status` em regime incremental (steady-state saudável com `upserted = 0` deixa de ser `unknown`). Altera **somente** `creatives_status`. | Sim |

Migrations 9, 10 e 11 são correções aditivas (`create or replace`) das
migrations 8 — elas **não** editam os arquivos já aplicados; corrigem por cima.
Aplicadas na ordem, o resultado final é o schema correto.

## Como aplicar

### Produção — fluxo trackeado (obrigatório)

```
npx supabase link --project-ref <ref-do-projeto-prod>
npx supabase db push
```

`db push` aplica as migrations pendentes **na ordem** e registra cada uma em
`supabase_migrations.schema_migrations`. **Não** aplicar arquivo-a-arquivo via
`supabase db query` em produção — isso quebra o tracking.

Se `db push` acusar qualquer diferença inesperada de schema: **parar** e revisar
antes de continuar.

### Revisão manual (opcional)

Abrir o projeto no Supabase → **SQL Editor**, colar o conteúdo do `.sql` e
executar. O editor roda tudo em uma transação. (Usado no Dev; não registra
tracking.)

## Passos manuais pós-migration (bootstrap)

Descritos no rodapé do próprio `20260901120000_phase2_foundation.sql`:

- criar o primeiro usuário no painel de **Authentication**;
- promover para `agency_admin` via `update public.profiles set role = 'agency_admin' where id = (select id from auth.users where email = '<email-do-admin>')`;
- desligar **"Enable sign-ups"** (sem cadastro público);
- associar usuários-cliente a clientes via `public.client_users`.

## Regras

- Nunca commitar `.env.local` nem chaves.
- O app usa apenas a **publishable key** + JWT do usuário — a segurança real é a RLS.
- `service_role` tem bypass de RLS e **não deve ser usada pela aplicação**.
