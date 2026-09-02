# Edge Function — `meta-sync`

META 5 — primeira sincronização de dados **reais** (estrutura + insights base,
últimos 30 dias) das contas **vinculadas** de um cliente. Camada privilegiada:
lê `meta_connection_secrets` e descriptografa o token só em memória.

## Estado

**NÃO publicada.** Depende da migration `20260902160000_meta_sync.sql`
(também não aplicada) e da migration META 3 já aplicada.

## Contrato

`POST /functions/v1/meta-sync` — `Authorization: Bearer <access_token do usuário>`

Body: `{ "clientId": "<uuid>" }`

Para cada conta `is_linked` do cliente:
`meta_sync_acquire` (trava de concorrência) → `campaigns`/`adsets`/`ads`
(`upsert on conflict` pelo id da Meta) → insights `account`/`campaign`/`adset`/`ad`:
- **diário** (`time_increment=1`) com `time_range` calculado — o horizonte que
  cobre TODOS os presets sem buracos: `until` = hoje (fuso da conta),
  `since` = menor entre (hoje − 30) e (1º do mês anterior);
- **agregado** (sem `time_increment`) — UM por preset (`today`, `yesterday`,
  `last_7d`, `last_14d`, `last_30d`, `this_month`, `last_month`); a unicidade em
  `meta_insights_periodic` é o INTERVALO, então os 7 convivem.

→ `meta_sync_release`.

Resposta 200: `{ "status": "ok"|"error", "dateFrom", "dateTo", "results": [ { adAccountId, runId, status: "success"|"partial"|"error", stats } ] }` — **sem token**.

Erros: `401 unauthorized`, `403 forbidden`, `400 bad_request`,
`409 not_connected | no_connection_secret | no_linked_account`,
`500 misconfigured | decrypt_failed`. Por conta, dentro de `results[]`:
`sync_already_running`, `token_revoked`, `acquire_failed`, ou `status: "partial"`.

## Regras

- Métricas base: `spend, impressions, reach, clicks, inline_link_clicks, frequency`.
- **Conversões (V1):** também busca `actions` / `action_values` e grava
  `actions`/`action_values` (resolvidos por PRIORIDADE — sem dupla contagem, ver
  `_shared/actions.ts`) + `raw_actions`/`raw_action_values` (crus, auditoria).
  `actions.results` só é gravado quando o evento de `dashboard_configs.result_metric`
  do cliente veio na resposta. **Não** pede `action_attribution_windows` (usa o
  padrão do anunciante = o que o Ads Manager mostra). Conversões só aparecem em
  `/meta-data` — não entram no dashboard principal ainda.
- **Precisa da migration `20260902170000_meta_conversions.sql`** para os
  agregados de período gravarem as colunas jsonb (o diário já grava direto).
- **`reach`/`frequency` do período** vêm da chamada agregada → `meta_insights_periodic`. Nunca da soma do diário.
- Sem criativos nesta etapa (mas `meta_ads.creative_id` é gravado quando vem).
- Nenhum `console.*`. `meta_sync_runs.error_text` recebe só códigos/stage names.
- Idempotente: rodar de novo não duplica campanha, conjunto, anúncio nem insight.

## Secrets

Reaproveita a META 2/3 — **nada novo**: `META_TOKEN_ENC_KEY` + auto-injetados.
`META_GRAPH_BASE`/`META_GRAPH_VERSION` opcionais.

## Deploy (quando autorizado — NÃO rodar agora)

```bash
npx supabase db push                 # aplica 20260902160000_meta_sync.sql
npx supabase functions deploy meta-sync --project-ref <ref>
```
