# Bernal Intelligence — Checkpoint: Agency Overview Real V1

> Checkpoint técnico do estado do projeto após a validação da **Agency
> Overview Real V1** — a tela "Visão geral" deixou de usar dados mockados e
> passou a ser a central de operação da agência, sobre dados reais.
>
> Tag: `checkpoint-agency-overview-v1` · Branch: `feat/fundacao-mvp`
> Base: `checkpoint-auto-sync-v1` (AUTO SYNC V1 continua válido e intocado).

## Estado validado

### Zero mock na "Visão geral"
- A página `/` (Visão geral) **não usa nenhum dado demonstrativo**. Toda
  informação vem de `clients`, `meta_connections`, `meta_ad_accounts`,
  `meta_insights_periodic`, `meta_insights_daily`, `dashboard_configs` e da
  view `meta_client_sync_health`. Cliente sem Meta/sem dado aparece como tal
  (nunca card preenchido silenciosamente).

### Cards e números
- **Clientes ativos**: contagem real de `clients.status = active` (+ quantos
  com Meta conectada).
- **Investimento gerenciado**: soma real de spend das contas Meta vinculadas
  aos clientes ativos, no período selecionado. Quando a cobertura é parcial,
  o card diz "N de M clientes com dados no período" — soma parcial nunca é
  apresentada como completa.
- **Contas Meta**: nº de `meta_ad_accounts.is_linked = true` dos clientes
  ativos (+ "X contas em Y clientes").
- **Saúde da operação**: derivada **exclusivamente** de
  `meta_client_sync_health` (nenhum health paralelo). "N de M clientes
  atualizados" + quantos precisam de atenção.

### Resultados
- **"Resultados principais"** — os clientes são agrupados pela **métrica
  canônica** configurada em `dashboard_configs.result_metric` (a MESMA
  resolução do dashboard individual). "Conversas iniciadas", "Compras",
  "Leads", etc. são grupos **separados** — **resultados de tipos diferentes
  nunca são somados juntos**.
- **Custo por resultado do grupo** = `SUM(spend) / SUM(results)` do grupo,
  nunca a média dos custos individuais. `results = 0` → mostra "—".
- Grupo sem nenhum cliente com dado não vira card (evita "0" inventado).
- Cliente com `result_metric` genérico/não configurado aparece como
  "Não configurado" (nunca a label operacional vazia "Personalizado").

### Métricas agregadas
- **Spend / impressões / cliques** somam entre contas e clientes (unidades
  distintas, sem dupla contagem).
- **CTR / CPC / CPM** são **recalculados sobre os totais** (via o Registry de
  métricas), nunca a média das métricas derivadas por cliente.
- **Reach / frequência NÃO são agregados** — não há deduplicação de pessoas
  entre contas/clientes, então a V1 não os mostra na Agency Overview.

### Gráficos e tabela
- **"Investimento ao longo do tempo"**: série diária real de
  `meta_insights_daily`, somada por dia entre todas as contas elegíveis. Dia
  sem linha não é desenhado (nunca R$0 artificial); `spend = 0` real é
  mostrado como R$0.
- **"Investimento por cliente"**: barra horizontal Top 10, altura dinâmica,
  nome truncado com o nome completo no tooltip.
- **Tabela operacional de clientes**: Cliente · Meta · Investimento ·
  Resultado principal · Resultados · Custo/resultado · Performance ·
  Criativos · Última sync · Ação. Filtro (Todos / Atualizados / Atrasados /
  Sem Meta / Com problema) e ordenação (Investimento ↓ padrão, Resultados,
  Custo/resultado, Última sync) — lógica pura, fora do componente React.

### Multi-conta / multi-connection / fuso
- **N ad accounts por cliente**: os totais somam as contas vinculadas; o
  cliente aparece **uma vez**.
- **Estado Meta agregado por connections RELEVANTES**: uma connection só pesa
  no status se houver ≥1 conta `is_linked = true` apontando para ela
  (connections órfãs/antigas são ignoradas). Prioridade:
  revoked/expired/reconnect > expiring > connected > sem Meta. Não é "a
  connection mais recente".
- **America/Sao_Paulo** é o calendário de INTERFACE da Agency Overview
  (presets Hoje/Ontem/Este mês/Mês passado). Isso NÃO muda o fuso de
  ingestão/sync das contas.

### Fonte de período — correção validada
- **`meta_insights_periodic` só é autoritativa no INTERVALO EXATO**: a linha
  usada precisa ter `date_from`/`date_to` iguais ao range calculado
  (`period_key` sozinho + "maior date_to" causava defasagem silenciosa de
  1 dia durante parte do dia). Regra pura compartilhada entre Agency Overview
  e dashboard individual.
- **`unified_attribution` tem prioridade** determinística; o valor legado
  (`7d_click_1d_view`) só entra se não houver `unified` para o mesmo
  intervalo — nunca dependendo da ordem do banco.
- **Daily deduplicado por `(conta, dia)`** com a mesma prioridade de
  atribuição — nunca soma `unified` + legado da mesma conta/dia.
- **Fallback diário para contas em outro fuso é best-effort**: sem
  granularidade horária, uma fronteira `00:00→00:00` no calendário da
  agência não é reconstruível perfeitamente para uma conta em outro fuso —
  o diário ali é um fallback determinístico, não uma equivalência temporal
  perfeita. Sinalizado por `hasMixedTimezones` na camada de dados.

### Semântica de ausência
- **"Zero real" ≠ "sem dado"** em todo agregado, card e célula: `spend = 0`
  sincronizado → "R$ 0,00"; cliente sem sync no período → "—". Clientes sem
  dado não entram nos agregados/rankings.

### Não tocado
- **Creative attribution / creative performance**, **AUTO SYNC V1**, **Cron
  (`pg_cron`)**, **`pg_net`**, **Vault**, **Edge Functions** e **migrations
  aplicadas** — inalterados. Nenhuma migration nova foi criada nesta fase.

## Limitações atuais (conhecidas, não são bugs)

- **Intelligence** (score, fadiga de criativo, recomendações, alertas) ainda
  não implementado.
- **Google Ads / TikTok Ads** ainda não integrados.
- **Comparação com período anterior** não existe na Agency Overview V1 (o
  controle foi escondido nesta tela; o dashboard individual mantém).
- **Contas em fuso != America/Sao_Paulo**: totais de período best-effort nas
  viradas de dia/mês (ver acima). Sem hourly sync.
- **Detecção de buraco por dia** dentro do range (dias não sincronizados) é
  sinalizada só pelo indicador de cobertura por cliente, não por dia.
- **Produção/publicação** ainda não feita — validado no projeto Supabase de
  desenvolvimento.

## Onde este estado vive (sem secrets/IDs sensíveis)

- Página: `app/(app)/page.tsx`.
- Dados (queries fixas, sem N+1, RLS de sessão): `server/agency-overview.ts`.
- Lógica pura testada: `lib/meta/agency-overview.ts` (agregação/regras),
  `lib/meta/agency-meta-status.ts` (estado Meta por connections),
  `lib/meta/agency-clients-table.ts` (filtro/ordenação),
  `lib/meta/periodic-select.ts` + `lib/meta/insights-attribution.ts`
  (seleção autoritativa de período — compartilhada com o dashboard
  individual), `lib/meta/agency-chart.ts`, `lib/plural.ts`,
  `lib/relative-time.ts`.
- UI: `components/agency/*`.
- Testes: `tests/agency/*`, `tests/meta/{periodic-select,insights-attribution,
  agency-meta-status}.test.ts`, `tests/plural.test.ts`,
  `tests/relative-time.test.ts`.
