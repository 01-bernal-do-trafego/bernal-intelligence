# Bernal Intelligence — Variáveis de ambiente (produção)

Referência dos nomes e finalidade das variáveis. **Nenhum valor real aqui.**
Modelo de arquivo local: `.env.example` (frontend/server); os Edge Secrets são
definidos por `supabase secrets set`, não em arquivo.

Três camadas conceituais:

## 1. `NEXT_PUBLIC_*` — enviadas ao browser (nunca segredo)

| Nome | Finalidade |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase (`https://<ref>.supabase.co`). Também deriva a base das Edge Functions. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable/anon key do Supabase — segura para o browser. **Nunca** a `service_role`/secret key aqui. |

Sem essas duas, o app entra em `unconfigured` (produção) → todo acesso é
barrado e redirecionado para `/login`. Nunca há bypass de autenticação em
produção.

## 2. Server (Next.js runtime — não vão para o browser)

| Nome | Finalidade | Obrigatória? |
|---|---|---|
| `META_APP_ID` | App ID da Meta (Facebook Login for Business). Sem ela o botão "Conectar Meta Ads" só mostra um aviso. | Para conectar Meta |
| `META_OAUTH_CONFIG_ID` | Configuration ID do "Facebook Login for Business" (carrega os escopos). | Para conectar Meta |
| `META_OAUTH_REDIRECT_URI` | URL do callback OAuth. **Precisa ser idêntica** à cadastrada em "Valid OAuth Redirect URIs" no app da Meta E à secret `META_OAUTH_REDIRECT_URI` da Edge Function. Prod: `https://<dominio>/api/meta/oauth/callback`. | Para conectar Meta |
| `SUPABASE_FUNCTIONS_URL` | Opcional. Base das Edge Functions; por padrão derivada de `NEXT_PUBLIC_SUPABASE_URL`. Sobrescrever só para runtime local. | Não |

## 3. Supabase Edge Function Secrets (`supabase secrets set` — só backend)

Definidas no projeto Supabase, nunca em arquivo do repositório, nunca no
frontend. O runtime da Edge Function também recebe `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (nome legado; valor = secret
key nova) auto-injetados.

| Nome | Finalidade |
|---|---|
| `META_APP_SECRET` | App Secret da Meta. Usado só na troca do `code` por token (`meta-oauth-exchange`). |
| `META_TOKEN_ENC_KEY` | Chave AES-256-GCM (32 bytes base64) que cifra/decifra o token da Meta. O token só é aberto dentro da Edge Function, nunca no browser/Next.js/logs. |
| `META_OAUTH_REDIRECT_URI` | Mesma URL de callback (item 2) — validada server-to-server no exchange. |
| `META_SYNC_CRON_SECRET` | Secret de alta entropia que autoriza o dispatcher `pg_cron` a chamar `meta-sync-scheduled` (comparado em tempo constante no header `x-meta-sync-cron-secret`). |

### Vault (Postgres — usado só pelo job `pg_cron`)

Cadastrados via `vault.create_secret(...)`; consumidos apenas pelo comando do
`cron.job` (ver `supabase/ops/meta-auto-sync-dispatch.sql`).

| Nome no Vault | Finalidade |
|---|---|
| `meta_sync_cron_secret` | Mesmo valor de `META_SYNC_CRON_SECRET` (lado Cron). |
| `project_url` | `https://<ref>.supabase.co` — base para o `net.http_post`. **A cadastrar no go-live.** |
| `publishable_key` | Publishable key do projeto — vai no header `apikey` do gateway. **Não** a service_role. **A cadastrar no go-live.** |

## Regra de ouro

- `service_role` / secret key: **só** dentro de Edge Functions (auto-injetada)
  e do Vault do banco. Nunca em `NEXT_PUBLIC_*`, nunca no bundle do browser,
  nunca em log.
- Token da Meta e cipher: nunca saem da Edge Function.
