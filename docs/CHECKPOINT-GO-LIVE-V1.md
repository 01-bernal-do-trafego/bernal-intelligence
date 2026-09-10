# Bernal Intelligence — Checkpoint: GO-LIVE V1

> Primeiro deploy público validado em produção com dados reais e Auto Sync
> automático rodando. Consolida os três checkpoints anteriores.
>
> Tag: `checkpoint-go-live-v1` · Branch de produção: `main`
> Base: `checkpoint-release-candidate-v1` + preflight de produção + correção de
> origem pública (`NEXT_PUBLIC_APP_URL`) + diagnóstico sanitizado do exchange.

## Arquitetura em produção

| Camada | Produção |
|---|---|
| **Domínio** | `https://dashboard.bernaldotrafego.com.br` — HTTPS válido |
| **Hosting do app** | Hostinger Business · Next.js 16 (`next start`) atrás de reverse proxy · deploy a partir da branch `main` do GitHub |
| **Backend / dados** | Projeto Supabase dedicado `Bernal Intelligence Prod` (região `sa-east-1`), **separado** do projeto de desenvolvimento |
| **Edge Functions** | Deno, publicadas no projeto de produção: `meta-oauth-exchange`, `meta-ad-accounts`, `meta-sync`, `meta-sync-scheduled` |
| **Agendamento** | `pg_cron` + `pg_net` + Vault no próprio projeto de produção |

Dev e Prod são ambientes isolados: banco, Auth, Edge Functions, secrets, Vault e
Cron próprios em cada um. O ambiente de desenvolvimento seguiu intocado por esta
fase.

## Autenticação (Prod)

- **Supabase Auth** real (e-mail/senha), sessão por cookie, RLS por
  `can_access_client` / `is_agency` / `current_app_role`.
- **Cadastro público desativado** — usuários são criados pela administração.
- Um usuário **`agency_admin`** inicial, criado manualmente e promovido pela via
  administrativa (sem senha em terminal, arquivo, resposta ou Git).
- Middleware protege as rotas nos dois sentidos; produção sem env → acesso
  barrado (nunca há bypass).

## Migrations

- **11 migrations** em `supabase/migrations/`, aplicadas ao projeto de produção
  pelo fluxo trackeado (`supabase db push`), na ordem cronológica do prefixo de
  timestamp — `supabase_migrations.schema_migrations` reflete corretamente.
- Prod nasceu **vazio**: schema criado só pelas migrations, **sem cópia de
  dados** do ambiente de desenvolvimento (clientes, perfis, conexões, insights,
  criativos e histórico de sync foram reconstruídos, não migrados).
- Os arquivos `.sql` são a fonte da verdade (ver `supabase/migrations/README.md`).

## Correção de origem pública (`NEXT_PUBLIC_APP_URL`)

- Atrás do reverse proxy da Hostinger, o `next start` derivava a origem do bind
  interno do processo (`0.0.0.0:3000`); redirects absolutos (callback do OAuth,
  redirects de sessão) apontavam para `https://0.0.0.0:3000/...` →
  `ERR_SSL_PROTOCOL_ERROR`.
- Introduzido `lib/app-url.ts` → `appOrigin(request)`: usa `NEXT_PUBLIC_APP_URL`
  como origem autoritativa quando configurada; senão, a origem do request (dev).
  **Não** deriva de `x-forwarded-host`.
- Aplicado em `app/api/meta/oauth/callback/route.ts`,
  `app/api/meta/oauth/start/route.ts` e `supabase/proxy.ts`.
- Resultado validado: o callback **não retorna mais `0.0.0.0:3000`**; o fluxo
  volta para o domínio público.

## Diagnóstico sanitizado do exchange

- `meta-oauth-exchange`: no caminho de falha da troca do code, uma única linha
  de log **sanitizada** — status HTTP da Meta, `error.type` / `error.code` /
  `error.error_subcode` e a mensagem redigida/truncada. Nunca authorization
  code, access token, App Secret, chave de cifra, JWT, header Authorization ou
  corpo cru. A resposta pública continua `exchange_failed` / HTTP 502.
- Lógica pura testável em `lib/meta/oauth-exchange-error.ts`; cópia mínima na
  fronteira Deno em `supabase/functions/_shared/graph.ts`.

## Meta Ads em produção

- **OAuth real** (Facebook Login for Business) funcionando no domínio público;
  token cifrado (AES-256-GCM) fora do browser/Next.js/logs.
- **Conta Meta real conectada**; conta de anúncios do cliente **Atacado do
  Chinelo** descoberta e vinculada (trava cross-cliente ativa).
- **Sincronização manual real** ("Sincronizar Meta") executada com sucesso.
- **Dados de performance reais**, **conversões reais** e **criativos reais** no
  dashboard do cliente.
- **Resultado principal** configurado: "Conversas iniciadas".

## Dashboard e Agency Overview

- Agency Overview Real V1 e dashboard individual config-driven, com a seleção
  canônica de `meta_insights_periodic` (intervalo exato + `unified_attribution`
  prioritária) compartilhada entre os dois.
- Calendário de interface em `America/Sao_Paulo`.

## Auto Sync V1 em produção

- **Cron ativo**: dispatcher `meta-auto-sync-dispatch` executando a cada 15 min.
- **Vault de produção** configurado (`project_url`, `publishable_key`,
  `meta_sync_cron_secret`) — consumidos apenas pelo comando do `cron.job`.
- Chamada Cron → Edge Function `meta-sync-scheduled` retornando **HTTP 200**.
- **Primeira execução automática real validada**: `trigger = cron`,
  `status = success`, `created_by = null`, `sync_batch_id` preenchido.
- Alvo de cadência ~4h por cliente elegível; cooldown de retry; creative sync
  incremental.

## Health / freshness (confirmado na UI de produção)

- **Dados de performance** = Atualizados
- **Criativos** = Atualizados
- **Última sincronização** = OK
- **Sincronização automática** = ativa (~4h)

> O aviso de "dias sem histórico diário" pode aparecer quando a Meta não retorna
> linhas de entrega para o período — é ausência de dados na origem, **não** falha
> do Auto Sync.

## Checkpoints anteriores (mantidos)

| Tag | O que consolidou |
|---|---|
| `checkpoint-auto-sync-v1` | `pg_cron` + `pg_net` + Vault + `meta-sync-scheduled`, validado em operação real no Dev |
| `checkpoint-agency-overview-v1` | Agency Overview Real V1, zero mock, queries batched, seleção canônica de periodic |
| `checkpoint-release-candidate-v1` | Auditoria de produto/UX/segurança/estados, 404 branded, docs de produção |

Todos permanecem intactos e apontando para os mesmos commits.

## Limitações conscientes (não são bugs)

- **Intelligence** (score, fadiga de criativo, recomendações, alertas) ainda não
  iniciado.
- **Google Ads** não integrado.
- **TikTok Ads** não integrado.
- **Recuperação de senha** ainda futura (estrutura preparada no login; falta
  SMTP + rota).
- **Upload de logo** do cliente ainda futuro (campo presente, sem upload).
- **Fuso misto na Agency Overview** continua **best-effort** nas viradas de
  dia/mês para contas fora de `America/Sao_Paulo` (sem hourly sync); sinalizado
  por `hasMixedTimezones`.
- **Dias sem entrega** na Meta podem não produzir linhas diárias — a cobertura
  por dia dentro do range é sinalizada só pelo indicador por cliente.
- Novas melhorias de produto ficam para a próxima fase.

## Estado no momento do checkpoint

- Aplicação pública no ar, HTTPS, Auth de produção funcionando.
- Auto Sync V1 ativo e saudável no projeto de produção (primeira execução
  automática real confirmada).
- Nenhuma migration nova, nenhum deploy de Edge Function, nenhum secret, Vault ou
  Cron alterado por esta fase de checkpoint.
