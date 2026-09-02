# Edge Function — `meta-oauth-exchange`

Troca segura do *authorization code* da Meta por um *access token*, cifra o
token (AES-256-GCM) e grava a conexão do cliente. **Única camada** que enxerga
o `client_secret` e o token em claro.

## Estado

**NÃO publicada.** Depende de secrets que você ainda não cadastrou e da
migration `20260902140000_meta_oauth.sql` (também não aplicada).

## Contrato

`POST /functions/v1/meta-oauth-exchange`

- Header: `Authorization: Bearer <access_token do usuário Supabase>` (enviado
  pelo route handler `/api/meta/oauth/callback`, server-to-server).
- Body: `{ "code": "<authorization code>", "clientId": "<uuid do cliente>" }`
- Resposta 200: `{ "status": "connected", "connectionStatus": "active", ... }`
  — **sem token**.
- Erros: `401 unauthorized`, `403 forbidden`, `400 bad_request`,
  `502 exchange_failed`, `500 misconfigured | encrypt_failed | persist_failed`.

## Secrets (você cadastra — nunca no chat, nunca no Git)

| Secret | Onde encontrar |
| --- | --- |
| `META_APP_ID` | Meta for Developers → seu app → **App settings → Basic** → *App ID* |
| `META_APP_SECRET` | mesma tela → *App secret* → **Show** |
| `META_OAUTH_REDIRECT_URI` | você define; tem que ser IDÊNTICA à do `.env.local` e à cadastrada em *Valid OAuth Redirect URIs* |
| `META_TOKEN_ENC_KEY` | você gera: `openssl rand -base64 32` (32 bytes → AES-256) |

Auto-injetados pela plataforma (**não cadastrar**): `SUPABASE_URL` e as chaves
de API. A função usa as legadas `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
e cai para o formato 2026 (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`,
JSON) quando as legadas não existirem — ver `../_shared/supabase.ts`. Deixe
`verify_jwt` no padrão (o chamador envia um JWT de usuário real, não uma API key).

Opcionais: `META_GRAPH_BASE` (default `https://graph.facebook.com`),
`META_GRAPH_VERSION` (default `v26.0`).

## Quando você for publicar (passos — NÃO rodar agora)

```bash
# 1. aplicar a migration da META 2 (SQL Editor ou):
npx supabase db push

# 2. cadastrar os secrets (rodado por você, fora daqui):
npx supabase secrets set META_APP_ID=...            # cola o valor você mesmo
npx supabase secrets set META_APP_SECRET=...
npx supabase secrets set META_OAUTH_REDIRECT_URI=https://SEU-DOMINIO/api/meta/oauth/callback
npx supabase secrets set META_TOKEN_ENC_KEY="$(openssl rand -base64 32)"

# 3. publicar a função:
npx supabase functions deploy meta-oauth-exchange
```

Local (`supabase functions serve`): aponte o Next para
`SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1` no `.env.local`.
