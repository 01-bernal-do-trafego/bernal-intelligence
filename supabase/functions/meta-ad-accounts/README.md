# Edge Function — `meta-ad-accounts`

META 3 — descobrir e vincular as contas de anúncio de um cliente já conectado
à Meta. Camada privilegiada: **única** que lê `meta_connection_secrets` e
descriptografa o token (só em memória).

## Estado

**NÃO publicada.** Depende da migration `20260902150000_meta_ad_accounts.sql`
(também não aplicada).

## Contrato

`POST /functions/v1/meta-ad-accounts` — `Authorization: Bearer <access_token do usuário>`

| body | efeito |
| --- | --- |
| `{ "action": "discover", "clientId": "<uuid>" }` | descriptografa o token, `GET /me/adaccounts` (paginado), upsert idempotente em `meta_ad_accounts`. |
| `{ "action": "link", "clientId": "<uuid>", "linkAdAccountIds": ["act_123", …] }` | define `is_linked` das contas escolhidas. Barra conta de outro cliente. |

Resposta 200: `{ "status": "ok", "accounts": [ { adAccountId, name, accountStatus, currency, timezoneName, businessId, businessName, isLinked, syncEnabled } ] }` — **sem token**. (O offset UTC não é persistido; deriva-se de `timezoneName` no app.)

Erros: `401 unauthorized`, `403 forbidden`, `400 bad_request`,
`409 not_connected | no_connection_secret | token_revoked | insufficient_permission | account_linked_elsewhere`,
`429 rate_limited`, `500 misconfigured | decrypt_failed | persist_failed | link_failed`,
`502 unknown`.

## Secrets

Reaproveita os da META 2 — **nada novo a cadastrar**:
`META_TOKEN_ENC_KEY` (para descriptografar), + auto-injetados
`SUPABASE_URL` / chaves de API. `META_GRAPH_BASE` / `META_GRAPH_VERSION`
opcionais (default `https://graph.facebook.com` / `v26.0`).

## Deploy (quando autorizado — NÃO rodar agora)

```bash
# 1. aplicar a migration META 3
npx supabase db push        # ou colar 20260902150000_meta_ad_accounts.sql no SQL Editor

# 2. publicar SOMENTE esta função
npx supabase functions deploy meta-ad-accounts --project-ref <ref>
```

Deixe `verify_jwt` no padrão (o chamador envia JWT de usuário real).
