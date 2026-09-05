# Bernal Intelligence — Checkpoint: Release Candidate V1

> Checkpoint técnico da versão preparada para publicação. Consolida os dois
> checkpoints anteriores e a auditoria de produto.
>
> Tag: `checkpoint-release-candidate-v1` · Branch: `feat/fundacao-mvp`
> Base: `checkpoint-agency-overview-v1` (que já incluía `checkpoint-auto-sync-v1`).

## Estado validado

### Plataforma / autenticação
- **Auth real** (Supabase Auth): login/logout, sessão de agência, papéis
  (`agency_admin` / `agency_member`), RLS por `can_access_client`.
- Middleware protege as rotas nos dois sentidos (sem sessão → `/login`;
  autenticado em `/login` → `/`; produção sem env → acesso barrado, sem
  bypass). Redirect pós-login com guarda contra open redirect.
- `/no-access` para conta autenticada sem papel de agência.

### Navegação / shell
- Sidebar: Visão geral, Clientes, Configurações navegáveis; Intelligence e
  Templates marcados "Em breve" e **não-clicáveis**. Topbar com conta e sair.
  Sidebar responsiva (drawer no mobile).

### Visão geral — Agency Overview Real V1
- **Zero mock.** Cards (Clientes ativos / Investimento gerenciado / Contas
  Meta / Saúde da operação), "Resultados principais" agrupados por
  `result_metric` canônico (tipos diferentes nunca somados; custo do grupo =
  SUM/SUM), gráfico diário real, "Investimento por cliente" (Top 10),
  "Saúde da operação", tabela operacional de clientes com filtro/ordenação.
- CTR/CPC/CPM recalculados sobre os totais; reach/frequência não agregados.
- N ad accounts por cliente somam; cliente aparece uma vez. Estado Meta
  agregado pelas connections **relevantes** (com conta `is_linked`).
- Calendário de interface = America/Sao_Paulo. `meta_insights_periodic` só é
  autoritativa no **intervalo exato**; `unified_attribution` prioritária;
  `meta_insights_daily` deduplicado por atribuição. "Zero real" ≠ "sem dado"
  em todo lugar.

### Clientes
- Lista real com filtro/busca. Criar / editar / arquivar cliente.
- Cliente arquivado não entra na Agency Overview.

### Dashboard individual (por cliente)
- Períodos (7 presets), cards, gráficos temporais, tabela de campanhas,
  `result_metric` config-driven, "Resultado principal", comparação com
  período anterior, estados para cliente sem Meta / sem sync / múltiplas
  contas. Métricas e conversões reais (mensageria liberada). Matemática
  validada — não alterada nesta fase.

### Editor do dashboard
- Configuração por cliente: seção "Resultado principal" (select amigável),
  cards, gráficos genéricos (métrica/visualização/título/ordem), colunas da
  tabela. Salvar/recarregar preserva o estado. Rótulos amigáveis, sem ids
  técnicos na UI.

### Meta Ads
- **OAuth real** (Login for Business), token cifrado (AES-256-GCM) fora do
  browser/Next.js/logs.
- Descoberta e vínculo de **ad accounts** (trava cross-cliente, transferência
  em reconexão).
- Estrutura (campaigns/adsets/ads), **insights diários** e **periódicos**,
  **conversões** configuráveis, **criativos reais** com atribuição
  observacional por dia (janela conservadora, melhora a cada sync).

### Sincronização
- **Sync manual** ("Sincronizar Meta") com feedback de produto (sem ids de
  conta nem nomes de stage na UI comum).
- **Auto Sync V1**: `pg_cron` (a cada 15 min) + `pg_net` + Vault →
  `meta-sync-scheduled` (secret dedicado, comparação em tempo constante);
  target ~4h por cliente; cooldown de retry; creative sync incremental.
- **Health/freshness** em 3 eixos (`meta_client_sync_health`): performance
  (idade), última execução (batch), criativos. Refletido na Visão geral e no
  dashboard individual.

### UI de produto / estados
- Cópia revisada: sem "área de administração", sem códigos Graph/SQL/stages
  em UI comum, sem linguagem de desenvolvedor nas rotas de produto.
- **LOADING / EMPTY / ERROR / NO-DATA** em todas as áreas principais; erros
  do backend viram mensagens amigáveis; sem `NaN`/`Infinity`/`undefined` na
  tela.
- **404 branded** global (`app/not-found.tsx`) + not-found próprio para
  cliente inexistente.

### Segurança (auditada)
- Nenhum `service_role`/secret em `NEXT_PUBLIC_*`; nenhum `"use client"`
  importa `server-only`/segredo; o app Next não tem construtor de client
  admin. Token Meta/cipher só nas Edge Functions. Sem `console.log` em código
  shipado (`console.error` só no error boundary). Sem `localhost` hardcoded
  fora de `.env.example`. RLS respeitada nas leituras server.

### Documentação de produção
- `docs/PRODUCTION-ENV.md` — variáveis em 3 camadas (NEXT_PUBLIC / Server /
  Edge Function Secrets + Vault), nomes e finalidade, **sem valores**.
- `docs/GO-LIVE-CHECKLIST.md` — redirect URI, domínio da Meta, URLs do
  Supabase, env do host, ativação do Cron de produção, migrations, papéis,
  smoke test.
- `docs/CHECKPOINT-AUTO-SYNC-V1.md`, `docs/CHECKPOINT-AGENCY-OVERVIEW-V1.md`.

### Código morto / mock
- Removidos (nenhuma rota usava): `server/portfolio.ts`,
  `components/portfolio/*`.
- Mantidos e **isolados** (só o modo demo dev, inacessível em produção):
  `lib/mock/{dataset,demo-performance,seed}.ts`, `server/mock-helpers.ts`,
  `server/period.ts`, o branch demo de `server/client-dashboard.ts`.

## Limitações conscientes (não são bugs)

- **Intelligence** (score, fadiga de criativo, recomendações, alertas) ainda
  não implementado.
- **Google Ads** não integrado.
- **TikTok Ads** não integrado.
- **Recuperação de senha** ainda futura (estrutura preparada no login).
- **Upload de logo** do cliente ainda futuro (campo presente, sem upload).
- **Publicação / domínio público** ainda pendentes — ver
  `docs/GO-LIVE-CHECKLIST.md`. O `META_OAUTH_REDIRECT_URI` de produção ainda
  não foi definido.
- **Fuso misto na Agency Overview**: contas em fuso != America/Sao_Paulo têm
  totais de período best-effort nas viradas de dia/mês (sem hourly sync).
  Sinalizado por `hasMixedTimezones`.
- **Detecção de buraco por dia** dentro do range é sinalizada só pelo
  indicador de cobertura por cliente, não por dia.
- Validado apenas no projeto Supabase de desenvolvimento.

## Estado operacional (no momento do checkpoint)

- Auto Sync V1 ativo e saudável no projeto de desenvolvimento (dispatcher a
  cada 15 min; ~6 sincronizações automáticas por dia por cliente elegível).
  **Não alterado** por esta fase.
- Nenhuma migration nova. Nenhum deploy de Edge Function. Nenhum secret
  alterado.
