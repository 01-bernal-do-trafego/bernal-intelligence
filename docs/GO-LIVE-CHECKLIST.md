# Bernal Intelligence — Checklist de publicação (go-live)

O que muda quando tivermos o domínio público. **Nada aqui foi alterado
ainda** — é a lista do que precisará ser feito.

## URLs / domínio

Hoje o código **não tem `localhost` hardcoded** em caminho de produção: links
internos são relativos (`/`, `/clients/...`), a base do app deriva de
`NEXT_PUBLIC_SUPABASE_URL`, e as bases da Meta (`graph.facebook.com`,
`www.facebook.com`) são fixas por design (overridáveis por env). Os únicos
`localhost` são exemplos de comentário em `.env.example`.

- [ ] **Meta OAuth redirect** — cadastrar `https://<dominio>/api/meta/oauth/callback`
  em "Valid OAuth Redirect URIs" no app da Meta.
- [ ] **`META_OAUTH_REDIRECT_URI`** (server + Edge Secret) — apontar para a URL
  de produção acima, **idêntica** nos dois lugares.
- [ ] **Domínios OAuth da Meta** — adicionar o domínio de produção em "App
  Domains" / "Allowed Domains" no painel da Meta.
- [ ] Se o app for servido de um domínio **diferente** do Supabase, conferir
  CORS/allowed origins do projeto Supabase (Auth → URL Configuration:
  Site URL + Redirect URLs).

## Env de produção

- [ ] Definir `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  no host de deploy.
- [ ] Definir `META_APP_ID`, `META_OAUTH_CONFIG_ID`, `META_OAUTH_REDIRECT_URI`
  (server).
- [ ] Edge Secrets já no projeto Supabase: `META_APP_SECRET`,
  `META_TOKEN_ENC_KEY`, `META_OAUTH_REDIRECT_URI`, `META_SYNC_CRON_SECRET`.
- [ ] Ver `docs/PRODUCTION-ENV.md` para a lista completa.

## Auto Sync (Cron) — se for para produção

- [ ] Cadastrar no Vault: `project_url`, `publishable_key` (o
  `meta_sync_cron_secret` já existe). Ver `supabase/ops/meta-auto-sync-dispatch.sql`.
- [ ] Rodar o `supabase/ops/meta-auto-sync-dispatch.sql` no projeto de
  produção para (re)criar o job `meta-auto-sync-dispatch`.
- [ ] Redeploy das Edge Functions (`meta-sync`, `meta-sync-scheduled`,
  `meta-oauth-exchange`, `meta-ad-accounts`) no projeto de produção.
- [ ] Aplicar todas as migrations de `supabase/migrations/` no projeto de
  produção, na ordem do timestamp.

## Antes de abrir para a equipe

- [ ] Confirmar que membros da equipe têm `profiles.role` de agência
  (`agency_admin` / `agency_member`) — sem isso caem em `/no-access`.
- [ ] Rodar `npm run build` limpo.
- [ ] Smoke test: login, Visão geral, abrir 1 cliente, Sincronizar Meta.
