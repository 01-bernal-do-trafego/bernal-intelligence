# Bernal Intelligence — Data Foundation V2

> Fundação de dados para as próximas evoluções (histórico longo, comparações
> livres, builder de dashboard, funis, breakdowns, Instagram, financeiro,
> Intelligence). Construída em blocos, sem big-bang, sem colocar a produção em
> risco.
>
> Bloco entregue nesta etapa: **DATA V2.0 — Metric Registry V2 + Aggregation
> Safety + DataQuality Foundation.** Só código local + testes. Nenhuma migration,
> nenhum Supabase/Meta tocado, nenhum número ou tela alterada.

## Objetivo

Preparar corretamente a arquitetura para: histórico muito maior que 30 dias,
comparação entre quaisquer períodos, um Metric Registry extensível, dezenas de
métricas úteis da Meta, dashboard builder com escolha livre de métricas, novos
gráficos, funis configuráveis, ranking de criativos, breakdowns de audiência,
Instagram, saldo/orçamento, alertas e uma camada confiável para o Intelligence.

**Nenhuma dessas features é construída ainda.** V2.0 só põe a base.

## Princípios arquiteturais

1. **Camadas separadas por responsabilidade** — ingestão operacional ≠ backfill
   histórico ≠ enriquecimentos ≠ query layer ≠ registry ≠ facts do Intelligence.
2. **Registry é a fonte da verdade.** Nenhum componente conhece uma métrica
   específica; tudo passa pelo registry.
3. **Segurança de agregação declarativa.** A classe matemática da métrica define
   o que pode ser somado; consumidores nunca escolhem a operação.
4. **Fato fino + jsonb curado + `raw_*` preservado** (blocos futuros).
5. **Compatibilidade incremental.** V2 adiciona ao lado; V1 continua funcionando.
6. **Ausência de dado nunca vira zero.**

## Aggregation classes

Toda métrica REAL do registry declara `aggregationClass`. (Um placeholder de
arquitetura sem semântica matemática — ex.: `performance_trend` — fica
deliberadamente **sem** classe: `getMetricAggregationClass` devolve `null`.)

| Classe | Significado | Exemplos |
|---|---|---|
| `additive` | soma direta (tempo E entidades) | `spend`, `impressions`, `clicks`, `inline_link_clicks`, conversões contáveis (`leads`, `purchases`, `messaging_*`...), `revenue`, `results` |
| `unique_non_additive` | **não somável e não reconstruível** por soma de componentes — só do agregado periódico exato | `reach`, `frequency`, `video_avg_time_watched` |
| `ratio` | recalcular sobre **totais brutos** (num/den) | `ctr`, `ctr_link`, `cpc`, `cpm`, `cpa`, `cpl`, `roas`, `cost_per_result`, `cost_per_conversation`, `hook_rate`, `thruplay_rate` |
| `weighted_avg` | média ponderada por um denominador de volume **armazenado** | *(reservada — nenhuma métrica atende hoje; ver conclusão sobre `video_avg_time_watched`)* |
| `snapshot` | valor de um ponto no tempo | *(reservada — `balance`, `spend_cap`, `account_status`; bloco V2.7)* |

### As formas de agregação (`aggregationMethod`)

O helper `aggregationMethod(id)` devolve **explicitamente** o que fazer:

- **`direct_sum`** — `SUM(valores)` das linhas dá o total. Só `additive`.
- **`recompute_from_components`** — NÃO somar o valor; somar os **componentes
  brutos** e reaplicar a fórmula. Ex.: CTR do período = `Σclicks / Σimpressions`;
  CPA = `Σspend / Σpurchases`; CPM = `Σspend / Σimpressions × 1000`. Válido só
  quando **todos** os componentes são `direct_sum`.
- **`exact_periodic_only`** — nem soma, nem recálculo: só de
  `meta_insights_periodic` no intervalo exato (regras do Ads Manager).
  `reach` (pessoas únicas), `frequency` (depende do `reach` do período — um
  componente não somável), `video_avg_time_watched` (média sem denominador de
  peso armazenado).
- **`none`** — sem semântica matemática (placeholder). Nenhum consumidor agrega.

## Metric Registry V2

`MetricDefinition` ganhou campos **aditivos** (nenhum campo V1 foi removido ou
alterado):

| Campo | Uso | Consumidor |
|---|---|---|
| `aggregationClass` | classe matemática (tabela acima) | aggregation safety, query layer, builder |
| `unit` | `currency \| count \| percent \| decimal \| duration \| ratio` — unidade conceitual, independente do `format` de UI | eixos/formatação do builder |
| `chartRoles` | `kpi \| timeseries \| categorical \| table \| funnel \| intelligence` — papéis que a métrica pode exercer | builder (o que oferecer), sem implementar nenhum gráfico novo |
| `funnelEligible` | `true` só para volume/evento — pode ser **etapa** de funil | contrato de funil (futuro) |
| `breakdownsCompatible` | dimensões aceitas — **`[]` para todas nesta fase** | bloco DATA V2.6 |
| `dependencies` | ids dos quais a métrica depende (para fórmulas deriva dos operandos) | query layer (o que buscar), Intelligence |
| `significanceMetric` | métrica cujo **volume** indica se há amostra suficiente (ex.: CPA → `purchases`) | Intelligence (futuro `insufficient_sample`) |
| `relatedMetrics` | correlatos **fortes** para `supportingSignals` do Intelligence | contrato de FACTS (futuro) |

Preservado integralmente da V1: `id`, aliases (`investment → spend`), `source`
(`column | action | formula`), `format`, `behavior`, `aggregation`,
`periodSource`, `levels`, `visualizations`, `availability`, `requiresEvent`,
`configDriven`, `followsClientResultMetric`, `dashboardSurfaces`.

### Compatibilidade V1

- `METRIC_REGISTRY` continua `readonly MetricDefinition[]`; todos os IDs atuais
  intactos.
- `isMetricAdditive(id)` **evoluiu** para se basear em
  `aggregationClass === "additive"` em vez de `aggregation === "sum"`. Para
  **todas** as métricas atuais o resultado é **idêntico** ao anterior — teste
  `registry-v2` verifica isso métrica a métrica. Nenhum número muda.
- `visualizations` (`line/area/bar/horizontal_bar`) continua sendo a fonte do
  editor de dashboard atual; `chartRoles` é um eixo **novo e paralelo**.
- Todo `ResultMetricType` salvo em `dashboard_configs.result_metric` (exceto o
  modo `custom`) continua resolvendo no registry.
- `results` / `cost_per_result` continuam `configDriven` (resolvidos em leitura).
- Conversões canônicas continuam `source.kind === "action"` e são re-resolvidas
  de `raw_actions` em leitura (sem re-sync).

## Aggregation Safety (`lib/metrics/aggregation.ts`)

Helpers **puros** que impedem agregação matematicamente errada. A API é
**explícita** — o consumidor pergunta "o que fazer", não recebe um booleano
ambíguo:

| Helper | Retorna |
|---|---|
| **`aggregationMethod(id)`** | `direct_sum \| recompute_from_components \| exact_periodic_only \| none` — a resposta canônica |
| `getMetricAggregationClass(id)` | a classe declarada; se ausente, deriva conservadora — **nunca** `additive` nem `weighted_avg` por derivação; `null` para placeholder |
| `isAdditiveMetric(id)` | `true` só para `additive` |
| `canSumAcrossTime(id)` | `true` só quando `aggregationMethod === "direct_sum"` — somar as linhas diárias dá o total |
| `canSumAcrossEntities(id)` | idem entre entidades (`snapshot` futuro: `false` por padrão — somar carteiras é opt-in da UI) |
| `canRecomputeFromComponents(id)` | `true` quando o total vem de agregar os **componentes brutos** e reaplicar a fórmula (ratios cujos componentes são todos `direct_sum`) — CTR, CPC, CPM, CPA, ROAS… |
| `requiresExactPeriodicAggregate(id)` | `true` quando só há uma via: `meta_insights_periodic` no intervalo exato — `reach`, `frequency`, `video_avg_time_watched` |
| `canUseMetricInChartRole(id, role)` | `true` se a métrica declara o papel |
| `canUseMetricInFunnel(id)` | `true` só para `funnelEligible` |
| `getSignificanceMetric(id)` / `getRelatedMetrics(id)` / `getMetricDependencies(id)` | metadados do Intelligence |

`lib/metrics/registry.ts` mantém `isMetricAdditive` e `requiresPeriodicAggregate`
(nomes já usados por testes). Nada em produção agrega via estes helpers hoje —
eles existem para os blocos seguintes.

### Conclusões da micro-auditoria matemática

- **`performance_trend`** — NÃO é `snapshot` (não é um valor pontual como saldo).
  É um placeholder de indicador Bernal, sem implementação e fora de qualquer
  agregação. Fica **sem `aggregationClass`** → `getMetricAggregationClass` = `null`,
  `aggregationMethod` = `"none"`. Nenhuma classe nova foi criada.
- **`video_avg_time_watched`** — o denominador correto do weighted avg é
  `video_plays` (total de reproduções), que **não é armazenado** hoje
  (`video_3s_views`/`video_thruplays` não servem). Sem denominador confiável o
  helper **não pode afirmar** `weighted_avg`. Classificada conservadoramente como
  `unique_non_additive` → `exact_periodic_only` (idêntico ao comportamento V1:
  `periodSource: "periodic_only"`, nunca somada). `weighted_avg` permanece no
  `type` para quando `video_plays` for coletado.

## Regras matemáticas (formalizadas)

- **`reach` não pode ser somado entre dias nem entre entidades.** Idem
  `frequency`. Testes tornam a regressão impossível
  (`aggregation-safety.test.ts`).
- **Métricas calculadas (CTR/CPC/CPM/CPA/CPL/ROAS/…) sempre sobre totais
  brutos.** Nunca média das taxas diárias. `lib/metrics/compute.ts` já faz assim;
  os testes de `real-metrics` e `registry-v2` protegem.
- **Zero real ≠ ausência de dado.** `resolveValuePresence({ value, dataQuality })`
  → `value` | `real_zero` | `no_data` | `missing`. `null`/`undefined` nunca vira
  `0`; `0` com dado presente é `real_zero`.

## DataQuality contract (`lib/data-quality.ts`)

Contrato tipado e **puro** para "quão confiável é este número", consumível por
dashboard, alertas e Intelligence.

```
DataQualityState =
  ok | real_zero | no_data | no_delivery | partial | stale | rate_limited
  | metric_not_available_in_period | not_consolidable | unconfirmed
  | insufficient_sample | tracking_suspect | backfill_incomplete
```

### Estados realmente PRODUZIDOS nesta fase

`getDataQuality()` só devolve o que tem **evidência V1**:

| Estado | Evidência | Fonte |
|---|---|---|
| `ok` | tem linhas + cobertura completa + `performance_status = fresh` | `rangeCoverage` + `meta_client_sync_health` |
| `partial` | intervalo com dias sem dados no histórico diário | `rangeCoverage` (`missingDates`) |
| `stale` | cobertura completa mas `performance_status = stale` (ou nenhum sync essencial-completo) | `meta_client_sync_health` / `lib/meta/sync-health.ts` |
| `no_data` | sem nenhuma linha para a entidade+intervalo | chamador (`hasRows`) / cobertura vazia |

`PRODUCED_DATA_QUALITY_STATES` e `FUTURE_DATA_QUALITY_STATES` são exportados; os
testes verificam que `getDataQuality` **nunca** devolve um estado "futuro".

### Estados apenas PREPARADOS (sem produtor nesta fase)

`real_zero`, `no_delivery`, `rate_limited`, `metric_not_available_in_period`,
`not_consolidable`, `unconfirmed`, `insufficient_sample`, `tracking_suspect`,
`backfill_incomplete`.

Regras explícitas:

- **Nunca inferir `no_delivery` a partir de `no_data`.** Só sabemos "não há
  linha", não sabemos se houve veiculação.
- **Nunca inferir `tracking_suspect` / `not_consolidable` sem sinal concreto.**
- `rate_limited` não tem sinal exposto à camada de leitura hoje → não é
  produzido.
- Nenhuma lógica futura foi inventada.

### Integração com a UI

**Não integrado ao `real-dashboard.ts` nesta fase.** Camada paralela, testada. Só
será ligada quando houver **paridade 1:1 comprovada** com os avisos/números
atuais. Preferimos não integrar a arriscar mudar a tela agora.

## DATA V2.1 — Query Layer

Camada genérica de consulta e cálculo, em `lib/query/`. **Em paralelo** ao
runtime V1 (`server/real-dashboard.ts`, `server/agency-overview.ts`) — nenhum
consumidor a chama ainda, nenhuma tela muda, nenhum dos dois arquivos foi
tocado nesta fase.

### Responsabilidades

Nenhum consumidor futuro (builder, funil, ranking, Intelligence) precisa saber
qual coluna SQL representa a métrica, se é `action_type`, se é fórmula, se é
aditiva, se precisa do periódico exato, ou como a janela de atribuição é
escolhida — a Query Layer + o Metric Registry V2 decidem isso.

### API pública

| Função | Arquivo | Faz |
|---|---|---|
| `resolveMetricTotals(input)` | `lib/query/metric-totals.ts` | total de N métricas para um escopo + intervalo |
| `resolveMetricSeries(input)` | `lib/query/metric-series.ts` | série diária de N métricas para um escopo + intervalo |
| `compareMetricValues(current, previous)` / `resolveMetricComparison(current[], previous[])` | `lib/query/metric-comparison.ts` | delta absoluto/percentual, null-safe |

Entrada comum: `scope { clientId, level, entityIds }` + `range { from, to }`
(**não** presets — resolver um preset num `DateRange` é responsabilidade de
quem chama, hoje `lib/meta/date-preset.ts`) + `metricIds` + `resultMetric?`
(contexto de `dashboard_configs.result_metric`) + as linhas **já buscadas**
(`dailyRows`/`periodicRows`, normalizadas nos mesmos nomes de coluna do banco).

**Separação DB / cálculo**: as três funções são **puras e síncronas** — não
fazem I/O. `lib/query/types.ts` documenta `InsightsReader`, a porta que um
adapter real (Supabase, DATA V2.2/V2.3) implementaria; **não implementada**
nesta fase — sem consumidor real, uma implementação seria código não testado
de verdade. O adapter real deve sempre filtrar `client_id` + `level` +
intervalo (+ entidade) NA QUERY, nunca `select *` sem range;
`lib/query/rows.ts` refiltra defensivamente por segurança, mas isso não
substitui um `WHERE` eficiente.

### Fonte dos totais e matemática

Paridade de comportamento com `real-dashboard.ts`: quando o escopo é **1
entidade** e existe uma linha `meta_insights_periodic` no intervalo **EXATO**,
os totais (aditivas E conversões) vêm **inteiramente** dela — não sofre buraco
de cobertura diária e bate com o Ads Manager. Senão, vêm da **soma das linhas
diárias** do escopo.

- **`direct_sum`** (aditivas): soma da fonte acima.
- **`recompute_from_components`** (ratios — CTR, CPC, CPM, CPA, CPL, ROAS,
  `cost_per_result`…): a fórmula é **reaplicada** sobre os componentes já
  somados/periódicos. Nunca `sum(ctr)`, nunca `avg(cpa)`.
- **`exact_periodic_only`** (`reach`, `frequency`, `video_avg_time_watched`):
  só do periodic exato, e só com escopo de **1 entidade** — multi-entidade
  nunca soma nem aproxima (`reach` de "3 contas" não existe sem a Meta
  agregar).
- Em `resolveMetricSeries`, o valor de cada DIA é recalculado sobre os
  componentes DAQUELE dia (ratio) ou lido nativamente da linha do dia
  (`reach`/`frequency`, só quando o escopo é 1 entidade). `reach` diário **pode
  aparecer como ponto da série** — o que é proibido é usá-lo para reconstruir
  um total multi-dia por soma; a série não expõe nenhum total, só pontos.

Reaproveita, sem duplicar: `conversionTotalsFromRow`, `sumRawMaps`,
`withResolvedResults`, `computeMetric`, `dedupeByAttribution`,
`selectAuthoritativePeriodicRow`, `percentChange`. Nenhuma lógica nova de
prioridade de atribuição ou de resolução de conversão foi criada.

### Zero vs no_data

Ausência de linha → `null` em todo `MetricValueResult`/`SeriesPoint`, nunca
`0`. Linha real com valor `0` → `0`. A soma de nenhuma linha (`sumOrNull` em
`lib/query/rows.ts`) devolve `null`, não `0` — mesma regra em totais e em série.

### Attribution

Reaproveitado sem alteração: `dedupeByAttribution` (linhas diárias, chave
`entity_id|date`) e `selectAuthoritativePeriodicRow` (linha periódica, intervalo
exato + prioridade `unified_attribution` > legado). Nenhuma lógica nova de
prioridade — a Query Layer não sabe o que é `unified_attribution`, só delega.

### DataQuality

Cada `MetricValueResult`/`MetricSeriesResult` carrega um `DataQuality` (V2.0).
Só os 4 estados já produzidos (`ok | partial | stale | no_data`) — nenhum
estado novo foi inventado. Indisponibilidades ESTRUTURAIS da Query Layer
(métrica desconhecida, nível incompatível, escopo multi-entidade não
consolidável, sem periodic exato) usam `state: "no_data"` com um motivo
honesto em `reasons` (`unknown_metric`, `level_not_supported`,
`not_consolidable_multi_entity`, `no_exact_periodic_match`,
`no_aggregation_semantics`) — `lib/query/quality.ts` só ACRESCENTA motivos,
nunca altera `lib/data-quality.ts` (V2.0, checkpointado).

### Falha segura vs falha dura

- **Segura** (não lança, não contamina os outros itens do pedido): metricId
  desconhecido, nível incompatível para a métrica, escopo não consolidável,
  sem periodic exato → aquele item volta `value: null` + motivo.
- **Dura** (lança `Error` — bug de quem chama, não estado de dado):
  `range.from > range.to`.

### Paridade V1

`tests/query/parity-v1.test.ts` prova, por CÓDIGO (não só coincidência
numérica): o mesmo fixture, resolvido pela Query Layer e pelos primitivos do
V1 chamados diretamente (`conversionTotalsFromRow` + `computeMetric` +
`withResolvedResults`), produz o **mesmo número** — para spend, impressions,
reach (via periodic exato), clicks, CTR, CPC, CPM, leads,
`messaging_conversations_started`, `results`/`cost_per_result` (config-driven)
e revenue/ROAS. Inclui o caso em que a soma diária diverge do periodic
(defasagem simulada) para provar que a Query Layer prefere o periodic exato,
exatamente como `real-dashboard.ts`.

### Limitações desta fase (o que fica para blocos seguintes)

- **Sem custom date ranges de verdade** — a Query Layer aceita qualquer
  `{from,to}`, mas não popula/consulta `meta_insights_periodic` sob demanda
  para um intervalo sem periodic sincronizado (`period_key='custom'`
  on-demand é DATA V2.3).
- **Sem histórico longo nem backfill** — resolve só sobre as linhas que
  recebe; não muda `dailyHorizon` nem o horizonte de sync (DATA V2.2).
- **Sem breakdowns** (DATA V2.6), **sem Instagram** (V2.10), **sem
  saldo/billing/alertas** (V2.7/V2.9).
- **`creative_analysis` fora do escopo** — Creative Ranking continua em
  `lib/meta/creative-attribution.ts`/`creative-performance.ts` (DATA V2.8
  decide se/como conecta à Query Layer).
- **Adapter real (Supabase) não implementado** — só a porta `InsightsReader`
  documentada; a implementação real chega com o primeiro consumidor (V2.2/V2.3).
- **Sem widget/data contract de gráfico** (`kpi`/`pizza`/`funil`/`tabela`) —
  isso é DATA V2.5, que consome `resolveMetricTotals`/`Series` por baixo.
- **Sem UI, sem substituição do dashboard V1.**

## DATA V2.2A — Historical Backfill Preflight

Auditoria + queries read-only no Prod real antes de desenhar o backfill —
ver `docs/HISTORICAL-BACKFILL-PREFLIGHT.md`. Resultado: **531 linhas / 816 kB**
em `meta_insights_daily` hoje — **decisão: não particionar, não criar BRIN**
agora (critérios objetivos e gatilhos futuros documentados ali). Achado
confirmado que molda o Control Plane abaixo: `meta_client_sync_health` não
diferencia `trigger`, então o backfill precisa de auditoria própria.

## DATA V2.2.1 — Historical Backfill Control Plane

Estrutura de CONTROLE do backfill: representa jobs/segmentos, estados,
progresso e concorrência — **sem buscar nenhum dado da Meta ainda**. Migration
local `20260910120000_meta_backfill_control_plane.sql`, **não aplicada** em
Dev/Prod nesta fase.

> **Micro-auditoria pós-implementação**: uma revisão do SQL real encontrou e
> corrigiu, **antes de qualquer aplicação**, uma inconsistência genuína
> (índice/RPC aceitavam `failed` no claim, mas a trigger só permitia
> `failed→pending` — a combinação `failed→running` teria sido REJEITADA em
> runtime) e 3 lacunas reais (nenhum limite a jobs ativos concorrentes por
> conta; nenhuma verificação de `is_linked`; nenhum mecanismo de fencing contra
> um worker obsoleto sobrescrever o resultado de outro). As seções abaixo já
> refletem o estado CORRIGIDO.

### Tabelas

- **`meta_backfill_jobs`** — 1 processo histórico por (`client_id`,
  `ad_account_ref`). Campos: `status`, `requested_levels` (reaproveita o enum
  `meta_insight_level` — sem tipo paralelo), `target_start_date`/
  `target_end_date`, `resolved_earliest_date` (fato observado, preenchido pelo
  planner futuro), `priority`, `paused_at`/`started_at`/`finished_at`,
  `last_error_code`/`last_error_at`, `created_by`/`created_at`/`updated_at`.
  **Deliberadamente sem** `oldest_date_fetched`/`newest_backfilled_date`/
  contadores de segmento — são DERIVÁVEIS de `meta_backfill_segments` (ver
  `meta_backfill_progress` abaixo); guardá-los duas vezes arriscaria
  inconsistência.
- **`meta_backfill_segments`** — 1 bloco de datas de um job (`level` +
  `date_from`/`date_to`). `attempt_count`/`last_attempt_at`/`last_error_code`/
  `next_retry_at` (reservada, sem cálculo de backoff nesta fase),
  `claimed_at`/`lease_expires_at`/`lease_token` (recuperação de worker morto +
  fencing, ver "Concorrência e lease" abaixo), `rows_written`/`pages_fetched`,
  `started_at`/`finished_at`.

### Estados e transições

**Job** (`meta_backfill_job_status`): `pending → running → {paused, completed,
exhausted, failed, cancelled}`; `paused → running`; os 4 terminais não saem —
retomar um job `failed` é **criar um novo job**, não reabrir o antigo.

**Segmento** (`meta_backfill_segment_status`): `pending → running → {done,
failed, skipped_no_data}`; `failed → pending` (retry — **duas etapas
distintas**: primeiro `failed → pending`, só depois `pending → running` via
claim); `running → pending` (recuperação de lease — não conta como falha).
`done`/`skipped_no_data` são terminais. **`failed → running` NUNCA é válido**
— corrigido explicitamente porque a versão inicial do claim tentava fazer
exatamente isso (ver "Concorrência e lease").

Ambas as máquinas são validadas em DOIS lugares que precisam concordar: uma
trigger `BEFORE UPDATE` em cada tabela (`..._check_transition`, recusa
transição inválida com `raise exception`) e `lib/backfill/transitions.ts`
(`isValidJobTransition`/`isValidSegmentTransition`, puro, testado). O
`attempt_count` é incrementado numa ÚNICA fonte (a trigger do segmento, ao
entrar em `running` vindo **só** de `pending`) — nunca pelo chamador, nunca a
partir de `failed` diretamente.

### Isolamento do Current Sync (confirmado na DATA V2.2A) — BEST-EFFORT, não atômico

O backfill **nunca** grava em `meta_sync_runs` — auditoria própria nas duas
tabelas acima. `claim_next_backfill_segment` só **lê** `meta_sync_runs`
(`NOT EXISTS ... status='running'`) para não competir com o Auto Sync pela
MESMA conta na Meta. `meta_sync_runs`, `meta_client_sync_health`,
`meta_sync_acquire_client`, `meta_clients_due_for_sync`,
`meta_eligible_ad_accounts`, `meta_essential_stages`, o Cron atual —
**nenhum foi tocado** por esta migration (guardado por teste).

⚠️ **Isto NÃO é exclusão atômica** — é um check-then-act sem lock
compartilhado com `meta_sync_acquire_client`. Existe uma janela real: o
backfill pode checar "nenhum sync rodando", e um sync operacional pode
adquirir a MESMA conta um instante depois, antes do backfill terminar seu
`UPDATE`. Fechar isso de verdade exigiria os dois lados tomarem o mesmo
`pg_advisory_xact_lock(hashtext(ad_account_ref::text))` — o que alteraria
`meta_sync_acquire_client` (Current Sync), fora do escopo desta etapa.
**Consequência prática**: nenhum executor real deve ser ligado (DATA V2.2.2+)
sem resolver esta janela antes. Documentado explicitamente no SQL (não
"fingido" como atômico) e coberto por teste.

### Múltiplos jobs por conta — histórico permitido, ativo único

Não existe (nem nunca existiu) `UNIQUE(client_id, ad_account_ref)`
permanente — uma conta pode ter **N jobs históricos** ao longo do tempo
(`completed`/`exhausted`/`failed`/`cancelled` nunca bloqueiam um job novo:
reparo de gaps, extensão de histórico, novo backfill após novas métricas).
O que a migration IMPEDE é **dois jobs ATIVOS conflitantes na mesma conta**:
índice único parcial `meta_backfill_jobs_one_active_per_account (ad_account_ref)
WHERE status IN ('pending','running','paused')`. Retomar um job `failed` é
criar um novo job (decisão mantida) — e esse índice garante que isso funciona
sem atrito assim que o antigo estiver num estado terminal.

### Concorrência e lease

`claim_next_backfill_segment(p_job_id?, p_lease default 10min)` — 1 `UPDATE`
atômico cuja `WHERE` usa uma subquery com `FOR UPDATE OF s2 SKIP LOCKED`: dois
workers concorrentes nunca reivindicam o mesmo segmento. **Só segmentos
`pending`** de um job `running` **de conta ainda `is_linked = true`** são
elegíveis — `failed` nunca é lido diretamente pelo claim (corrigido: a versão
inicial aceitava `pending`/`failed` no índice e na RPC, mas a trigger só
permitia `failed→pending` — a combinação `failed→running` teria sido
rejeitada em runtime; agora índice, RPC e trigger concordam: só `pending`).
`SECURITY DEFINER`, executável só por `service_role` (Next não ganha
service-role client — a regra estrutural do projeto continua valendo).

**Fencing (worker obsoleto)**: cada claim gera um `lease_token` novo
(`gen_random_uuid()`), devolvido ao chamador. Cenário coberto: worker A perde
a lease → `meta_backfill_release_stale_segments()` devolve o segmento a
`pending` (zerando `lease_token`) → worker B reivindica e recebe um token
NOVO → se A tentar "terminar" depois, uma futura RPC de finalização (DATA
V2.2.2, ainda não existe) exigiria o token de volta
(`WHERE id = ? AND lease_token = ?`) — o token de A não bate mais, a operação
afeta 0 linhas em vez de sobrescrever o trabalho de B. O SCHEMA já tem o
ingrediente (`lease_token`); a RPC de finalização em si é trabalho do
executor, fora desta etapa.

`meta_backfill_release_stale_segments()` devolve a `pending` todo segmento
`running` com `lease_expires_at` vencida — sem Cron chamando-a nesta fase
(chamada manual ou futura).

### Pause / resume / retry

Pause é um status do JOB: `claim_next_backfill_segment` só olha jobs
`status='running'` — um job `paused` nunca fornece segmento
(`canJobProvideSegments`, testado). Resume = voltar o job para `running`.
Retry de segmento = `failed → pending`, com `attempt_count` avançando
automaticamente na trigger.

### Progresso / telemetria

`meta_backfill_progress` (view, `security_invoker=true`) — `segments_total`/
`pending`/`running`/`done`/`failed`/`skipped`, `progress_percent`,
`earliest_completed_date`/`latest_completed_date`, tudo **derivado** de
`meta_backfill_segments` via `count(...)`/`min`/`max` — nenhum contador
duplicado no job. Nenhum log detalhado é guardado aqui (fica para uma camada
futura, se necessário).

### Segurança / RLS

Mesmo padrão das tabelas `meta_*` atuais: RLS habilitada, **1 policy de
SELECT** por tabela (`can_access_client`, direto em `meta_backfill_jobs`; via
`EXISTS` no job pai em `meta_backfill_segments`, que não tem `client_id`
direto), **nenhuma policy de INSERT/UPDATE/DELETE** para `authenticated` —
escrita só via as RPCs `SECURITY DEFINER` (que só `service_role` executa) ou
por bypass de RLS do próprio `service_role`. Nenhum service-role client no
Next.

### Isolamento cliente ↔ conta

`meta_ad_accounts` já amarra `client_id`, mas nenhuma tabela `meta_*` atual
valida a CONSISTÊNCIA entre um `client_id` próprio e o `client_id` de uma
`ad_account_ref` referenciada (só `meta_lock_client_id`, que trava
reatribuição, não a consistência inicial). Solução mínima criada:
`meta_backfill_check_account_client()` (trigger `BEFORE INSERT`, confirma que
a conta pertence ao cliente **E está `is_linked = true`** — não nasce job
para conta desvinculada) + `meta_lock_ad_account_ref()` (trava reatribuição de
conta, mesmo estilo de `meta_lock_client_id`) — as duas juntas impedem um job
do cliente A apontar para conta do cliente B, na criação e depois dela.

**Conta desvinculada DEPOIS que o job já existe**: a trigger de INSERT não
roda de novo (não há como "revalidar" um job já criado por trigger). Quem
barra esse caso é o **claim** (`claim_next_backfill_segment` rechecha
`is_linked = true` a cada tentativa) — um job cuja conta foi desvinculada
simplesmente para de receber segmentos novos, em vez de continuar
"trabalhando" silenciosamente numa conta que o cliente não usa mais.

### O que ainda NÃO existe

Migration **não aplicada** em Dev/Prod. Nenhum job real, nenhum segmento
real, nenhum planner de datas (7/14/30/90 dias — DATA V2.2.2), nenhum
executor que chama a Meta, nenhum Cron, nenhum `meta_rate_budget`
persistido, nenhum dado histórico novo em `meta_insights_daily`, nenhuma
mudança em produção.

## Próximos blocos (ordem por dependência técnica)

`V2.1` Query Layer ✅ (paralelo, opt-in) · `V2.2A` Historical Backfill
Preflight ✅ · `V2.2.1` Backfill Control Plane ✅ (schema local, não aplicado)
· `V2.2.2` Backfill Planner + Executor · `V2.3`
Custom ranges & reach on-demand · `V2.4` Metric catalog expansion · `V2.5`
Dashboard Builder data contract + gráficos novos (backend) · `V2.6` Breakdowns ·
`V2.7` Account Financial + Alerts · `V2.8` Creative Ranking · `V2.9` Client Goals
· `V2.10` Instagram Account Insights · `V2.11` Intelligence FACTS layer · `V2.12`
Scale hardening (condicional).

## Explicitamente NÃO feito nesta etapa

- **Backfill histórico** — não implementado. O Control Plane (DATA V2.2.1)
  existe como schema local **não aplicado**; nenhum job/segmento real, nenhum
  planner, nenhum executor que chama a Meta, nenhum Cron, nenhum
  `meta_rate_budget` persistido.
- **Particionamento de `meta_insights_daily`** — **decidido: não particionar
  agora** (dados reais do Prod na DATA V2.2A: 531 linhas, 816 kB, 0% dead
  tuples — ver `docs/HISTORICAL-BACKFILL-PREFLIGHT.md` para os critérios e
  gatilhos futuros).
- **Limite histórico** — **não hardcoded**. A regra conceitual é "todo o período
  disponível pela fonte"; o limite real será descoberto/validado pela
  integração, não presumido como constante (nada de "37 meses" no código).
- **`dailyHorizon`** — inalterado.
- **Instagram** — não implementado (API/permissões/tabelas/OAuth pendentes).
- **Breakdowns / saldo / alertas** — só o campo/`type` preparado, sem produtor.
- **Intelligence** — não implementada; só a base de metadados (`significanceMetric`,
  `relatedMetrics`) e o contrato `DataQuality`.
- **Query Layer (DATA V2.1)** — construída, mas **não substitui** `real-dashboard.ts`
  nem `agency-overview.ts`, **não** implementa custom date ranges de verdade
  (`period_key='custom'` on-demand), **não** tem adapter real (Supabase) —
  só a porta `InsightsReader` documentada — e **não** define nenhum data
  contract de widget/gráfico.
- **Backfill Control Plane (DATA V2.2.1)** — migration LOCAL, **não aplicada**
  em Dev/Prod; nenhum job/segmento real; nenhum planner de datas; nenhum
  executor/Edge Function que chama a Meta; nenhum Cron.
- **Nenhuma migration aplicada.** As migrations desta fase (`meta_backfill_*`)
  existem só como arquivo local. Nenhum Supabase, Edge Function, Cron, Vault,
  secret, Meta API ou deploy tocado. Nenhuma mudança visual. Nenhuma mudança
  numérica.
