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

## DATA V2.2.2 — Planner + Executor Foundation

Resolve o bloqueador crítico deixado pela V2.2.1 (coordenação best-effort) e
constrói a fundação de planejamento/execução — **sem planejar/rodar backfill
nenhum de verdade ainda**. Duas migrations locais novas, **nenhuma aplicada**:
`20260911100000_meta_backfill_sync_lock_coordination.sql` e
`20260911110000_meta_backfill_executor_foundation.sql`. Aplicadas e validadas
**só no Supabase Dev** — Prod permanece intocado.

### Coordenação Current Sync × Backfill — agora ATÔMICA

A V2.2.1 documentou a exclusão como best-effort (check-then-act sem lock
compartilhado). Corrigido com o protocolo **lock + estado persistido**
(auditado explicitamente — um advisory lock sozinho NÃO basta, porque
`pg_advisory_xact_lock` solta no fim da transação, então "soltar o lock" não
impede os dois lados de trabalharem em paralelo DEPOIS):

1. **Mesma chave nos dois lados** — `meta_backfill_account_lock_key(uuid)`
   (namespace fixo `77771` + `hashtext(ad_account_ref::text)`), 1 função só,
   usada por `meta_sync_acquire_client` E `claim_next_backfill_segment`.
2. **O lock protege só o INSTANTE da decisão**: sob o lock, cada lado (a)
   checa o **estado persistido** do outro (`meta_sync_runs.status='running'`
   ou `meta_backfill_segments.status='running'`) e (b) escreve o **próprio**
   estado persistido — tudo na MESMA transação.
3. Como as duas transações concorrentes na mesma conta disputam a MESMA
   chave, uma delas **sempre espera a outra COMMITAR** antes de prosseguir —
   e ao prosseguir, vê o estado já commitado do primeiro (visibilidade
   garantida pelo MVCC do Postgres) e desiste.
4. **Depois do commit o lock deixa de importar**: é o **estado persistido**
   (a linha `running`) que qualquer aquisição FUTURA de qualquer lado vai
   encontrar e respeitar — não o lock. O lock serializa só o par
   (checar, escrever); o estado é quem garante exclusão durante o TRABALHO.

`meta_sync_acquire_client` (Current Sync) ganhou um **loop de lock por conta
elegível, em ordem determinística** (`order by ad_account_ref` — evita
deadlock entre duas chamadas concorrentes da própria função, que nunca mais
pegariam locks em ordens diferentes) **antes** do `INSERT...SELECT` existente.
Se alguma conta tem backfill `running`, levanta a **MESMA** exceção
`sync_already_running` do caso já existente — **zero mudança em
`sync-core.ts`** (que já trata esse sentinel como skip esperado).
`claim_next_backfill_segment` ganhou uma **fase 2**: depois de escolher 1
segmento candidato (mesma lógica `FOR UPDATE SKIP LOCKED` da V2.2.1), toma o
MESMO lock e rechecha `meta_sync_runs` antes de marcar o segmento `running`.

Assinaturas **preservadas** nas duas funções — só o corpo muda.

### Planner (`lib/backfill/planner.ts`, puro)

`planBackfillSegments(input)` transforma a intenção de um job em
`SegmentPlan[]` — **sem inserir nada no banco** (isso é do adapter real,
V2.2.3+). Duas ordens deliberadas: dentro de cada nível, mais recente →
mais antigo (valor operacional); entre níveis, sempre
`account → campaign → adset → ad` (do mais barato/agregado ao mais
granular/caro, nunca intercalado por data). Sem overlap/gap **por
construção** (o próximo bloco sempre começa 1 dia antes do início do
anterior). `targetStartDate = null` sem `resolvedEarliestDate` conhecida →
`requiresDiscovery: true` e **zero segmentos** — nunca inventa um piso tipo
"37 meses".

### Tamanho dos blocos (`lib/backfill/block-size.ts`, puro)

Faixas configuráveis (`account` 60–90d · `campaign`/`adset` 14–30d · `ad`
7–14d) com um `default` por nível. Estratégia adaptativa **simples** (regra
fixa por contagem de entidades — `resolveBlockSizeDays`): conta com mais de
50 entidades naquele nível usa o bloco **mínimo** da faixa (mais chamadas,
mais leves); conta menor usa o **máximo**. `account` sempre usa o `default`
(1 linha/dia, sem heurística de tamanho). Cenário real conhecido (DATA
V2.2A): **Atacado do Chinelo (95 ads)** cai no bloco mínimo — é o teste de
carga natural; **Oversized Store (9 ads)** fica bem abaixo do limiar.
Explicitamente **não** é "verdade universal" — a estratégia real (baseada em
payload/timeout observados) só existe depois do primeiro backfill de
verdade.

### Discovery foundation (`lib/backfill/discovery.ts`, puro)

`resolveEarliestDate(input)` formaliza a decisão de `resolvedEarliestDate`
**sem chamar a Meta** — separado deliberadamente do planner. Prioridade:
campanha mais antiga conhecida > `account.created_time` > nenhuma base
(`unresolved`). `exhausted` = N blocos vazios consecutivos perto do início
conhecido (a Meta já não tem mais nada) — precisa de uma base para reportar
uma data; sem nenhuma, mesmo exaurido fica `unresolved`. A chamada real que
POPULA esses fatos (buscar `campaign.created_time`/`account.created_time` na
Meta) é executor, fase futura.

### Executor foundation (`lib/backfill/executor.ts`, puro + portas injetadas)

`executeBackfillSegment(task, deps)` — orquestração de 1 segmento: conta
linkada → rate budget → busca → (vazio → `skipped_no_data` | com linhas →
upsert → `done`) → finaliza com fencing. **Toda** operação com efeito
colateral é uma porta injetada (`BackfillExecutorDeps`) — `fetchInsights` é
só um TIPO, sem nenhuma implementação real no repositório; estruturalmente
não há como este módulo fazer uma chamada de rede (guardado por teste, tanto
comportamental quanto estático — grep por `fetch(`/`graph.facebook.com` no
código-fonte). `completeSegment`/`failSegment` devolvendo `false` vira
`{kind:"refused", reason:"ownership_lost"}` — nunca tratado como sucesso.

### Fencing — RPCs de finalização (fecha a lacuna da V2.2.1)

A V2.2.1 tinha `lease_token` no schema mas nenhuma RPC para usá-lo. Agora:

- **`complete_backfill_segment(segment_id, lease_token, rows_written?,
  pages_fetched?, outcome?)`** — `running → done | skipped_no_data`.
- **`fail_backfill_segment(segment_id, lease_token, error_code?,
  next_retry_at?)`** — `running → failed`.

As duas exigem `WHERE status='running' AND lease_token=$2` — **compare-and-
set**. Se um worker perdeu a posse (lease expirou, outro worker já
reivindicou), a chamada afeta 0 linhas e devolve `false` (não lança, não
sobrescreve o trabalho do worker atual).

### Heartbeat / lease extension

**`extend_backfill_segment_lease(segment_id, lease_token, lease?)`** — avança
`lease_expires_at`, mesmo fencing por `lease_token`, **mantém o mesmo token**
(não rotaciona) e **não muda `status`** (não é uma transição da máquina de
estados — segmento continua `running`). Necessário para segmentos que
demoram mais que a lease original.

### Retry foundation

**`meta_backfill_retry_eligible_segments()`** — `SEGMENT failed → pending`,
em lote, só quando `next_retry_at is null or next_retry_at <= now()`. Mesmo
padrão de `meta_backfill_release_stale_segments()` (V2.2.1): sem Cron
chamando-a ainda. **Distinção mantida explicitamente**: SEGMENT `failed` é
retryable (aqui); **JOB `failed` continua TERMINAL** (decisão da V2.2.1,
reafirmada — nenhuma RPC de retry de job foi criada; retomar = job novo).

### Rate-limit contract (`lib/backfill/rate-limit.ts`, puro)

`canRunBackfill(snapshot, thresholds?)` — contrato que o executor real vai
consultar antes de rodar um segmento. **`meta_rate_budget` (persistência)
não foi criado nesta fase** — decisão explícita (o executor real ainda não
chama a Meta, não há budget real para persistir ainda). O formato já espelha
`RateUsageSummary` de `graph.ts` (`app_max_pct`/`ad_account_max_pct`/
`buc_max_pct`/`throttled`) para que, quando `meta_rate_budget` existir, vire
este mesmo shape sem mudar a assinatura. Limiares conservadores por padrão
(60%) — o backfill é a prioridade mais baixa do sistema.

### Current Sync intocado (além da coordenação mínima)

`sync-core.ts`, normalizer, periodic, `dailyHorizon`, Auto Sync Cron,
`meta_sync_release`, `meta_client_sync_health`, Edge Functions — **nenhum
tocado**. `meta_sync_acquire_client` mudou **só** para acrescentar a
coordenação (loop de lock + checagem); mesma assinatura, mesmo
`RETURNS TABLE`, mesmo `sync_batch_id` compartilhado, mesmo
`INSERT...SELECT` atômico, mesma semântica de `sync_already_running`/
`no_eligible_account` — guardado por teste.

### O que ainda NÃO roda

As duas migrations **não foram aplicadas em Prod** (só Dev, para
validação). Nenhum planner real gerando segmentos de um job de verdade;
nenhum job/segmento real criado; nenhum executor real chamando a Meta;
nenhum adapter real para `fetchInsights`/`upsertDaily`/`isAccountLinked`/
`canRunBackfill`; nenhum Cron de backfill; nenhum deploy de executor;
nenhum `meta_rate_budget` persistido; nenhuma mudança em produção.

## DATA V2.2.3 — Real Backfill Executor

Transforma a fundação da V2.2.2 (contrato puro, sem adapter) num executor
REAL capaz de processar exatamente **1 segmento** de Historical Backfill —
ainda **sem chamar a Meta nesta sessão** (build + testes com mocks; o
piloto real fica para uma autorização separada).

### Auditoria do Current Sync — o que foi reutilizado (nada duplicado)

- **`listInsights`/`listEdge`** (`_shared/graph.ts`) — mesmo cliente HTTP.
  Refactor MÍNIMO: extraída `fetchEdgePage` (1 página) do corpo do loop de
  `listEdge` — `listEdge` passou a DELEGAR para ela, comportamento
  idêntico (mesma URL, mesmos headers, mesmo overflow guard, mesma
  acumulação). Nova função `listInsightsPage` (1 página, `time_range` +
  `time_increment=1`, sem `datePreset` — exclusivo do Backfill) usa a
  MESMA `fetchEdgePage`/`insightFields` de `listInsights`.
- **`toDailyRows`/`normalizeActions`** (`_shared/insights.ts`/`actions.ts`)
  — o MESMO normalizador do Current Sync, importado tal como está. Nenhum
  segundo normalizador, nenhum mapeamento de `action_type` duplicado.
- **`classifyGraphError`/`GraphApiError`** (`_shared/graph.ts`) — mesma
  classificação de erro; o executor não reclassifica nada a partir do
  código bruto da resposta Meta.
- **`openToken`** (`_shared/crypto.ts`) — mesma descriptografia AES-256-GCM.
- **`getRateUsage`/`resetRateUsage`** (`_shared/graph.ts`) — mesmo
  acumulador de rate usage por invocação.

Achado da auditoria (reportado, não corrigido silenciosamente): a porta
`fetchInsights`/`upsertDaily` da V2.2.2 usava `NormalizedDailyRow` (Query
Layer, DATA V2.1) — tipo insuficiente para popular `meta_insights_daily`
de verdade (falta `ad_account_ref`/`ad_account_id`, `campaign_id`/
`adset_id`/`ad_id`). Corrigido nesta etapa: novo tipo
`BackfillInsightRow` (`lib/backfill/insight-row.ts`), estruturalmente
idêntico ao `DailyInsightRow` que `toDailyRows` já produz.

### Arquitetura — par espelhado (Node puro × Deno real)

Fronteira Deno não importa de `lib/` (regra já estabelecida no projeto,
ver cabeçalho de `sync-core.ts`) — por isso o executor existe em DOIS
lugares, mantidos em sync manualmente (MESMO padrão já usado para
`_shared/insights.ts` ⟷ `lib/meta/normalizer.ts`):

- **`lib/backfill/executor.ts`** (Node, PURO, testado por Vitest) — o
  algoritmo de referência: `isAccountLinked` → `canRunBackfill` → por
  página `[heartbeat → fetch → heartbeat → upsert]` → `complete/fail`.
  Toda operação com efeito colateral é injetada (`BackfillExecutorDeps`)
  — nenhuma chamada de rede é estruturalmente possível aqui.
- **`supabase/functions/meta-backfill-executor/index.ts`** (Deno, GLUE
  fina, REAL) — mesmo algoritmo passo a passo, comentário cruzado no
  topo do arquivo. NÃO testado por Vitest (fora do runtime Node) — mesmo
  limite já aceito para `sync-core.ts`/`meta-sync/index.ts` no projeto.

### Paginação

Página a página (não acumula tudo em memória): `nextCursor` seguido com
guarda contra cursor repetido (`seenCursors`, aborta com
`pagination_loop_detected`) e teto defensivo `maxPages` (200, mesmo
default de `listEdge`; excedido → `pagination_overflow`). Página vazia é
válida (0 linhas, com ou sem próxima página).

### Heartbeat / ownership

`extend_backfill_segment_lease` (RPC já existente da V2.2.2) serve como
heartbeat E check de posse — a MESMA chamada só sucede se ainda formos o
dono. Chamado ANTES de cada request e ANTES de cada write (2x por
página). `false` em qualquer ponto → aborta IMEDIATAMENTE com
`{status:"refused", ownership_lost:true}` — nunca escreve depois de
perder a posse, nunca tenta `complete`/`fail` com o token antigo.

### Idempotência

Cada página é upsertada assim que chega (sem acumular para o fim) — se
uma página posterior falhar, as páginas já escritas PERMANECEM (sem
rollback). Reexecutar o segmento inteiro é seguro: `upsert` usa a MESMA
natural key de `meta_insights_daily` (`level,entity_id,date,
attribution_window`) do Current Sync — dados já escritos são só
sobrescritos pelo mesmo valor, nunca duplicados. Testado explicitamente
(rodar o mesmo segmento 2x → mesmo estado final).

### Zero data

Página única vazia sem próxima página → `skipped_no_data` (não é erro),
`rows_written=0`, `pages_fetched` reflete a chamada realizada.

### Error classification / retry

Reutiliza o vocabulário de `classifyGraphError` (`token_revoked`/
`insufficient_permission`/`rate_limited`/`transient`/`unknown`) — nenhuma
heurística nova. Backoff conservador por categoria
(`lib/backfill/error-classification.ts`, espelhado no Edge Function):
`rate_limited` 30min, `transient` 5min, `unknown` 15min, `token_revoked`/
`insufficient_permission` 60min. SEGMENT `failed` continua retryable
(V2.2.1) — nenhuma categoria "terminal" nova. `token_revoked` (e só esse
— mesma regra de `sync-core.ts`) marca `meta_connections.status =
'reauthorization_required'`; `insufficient_permission` NÃO.

### Rate usage

`canRunBackfill` (`lib/backfill/rate-limit.ts`, espelhado no Edge
Function) checado ANTES de cada página — não só uma vez no início.
`meta_rate_budget` continua **não criado** (decisão mantida da V2.2.2).

### Conta/conexão ainda válida

Auditado antes de decidir (pedido explícito): a elegibilidade do Current
Sync (`meta_eligible_ad_accounts`) exige `mc.status in ('active',
'expiring')`; o control plane do Backfill (claim) exige só `is_linked`.
**Decisão revista (ajuste pós-entrega): o executor AGORA exige
explicitamente `meta_connections.status in ('active', 'expiring')`** —
MESMA lista de `meta_eligible_ad_accounts`, checada por consulta direta
(`connection_id` já resolvido pelo claim) em vez de reusar a VIEW (que
filtra `meta_ad_accounts` para DESCOBRIR contas elegíveis — propósito
diferente de validar uma conta JÁ claimada). O check acontece ANTES da
resolução de secret/token e ANTES de qualquer `listInsightsPage` — uma
conexão `reauthorization_required`/`revoked`/qualquer status fora da
lista nunca chega a decifrar token nem chamar a Meta
(`fail(..., "connection_not_eligible")`, sem reescrever o status — a
conexão já está no estado correto). A resolução de secret continua como
segunda camada de defesa (`no_connection_secret`/`decrypt_failed`,
MESMO side-effect de `sync-core.ts`) para o caso de secret ausente/corrompido
mesmo com status elegível.

### Segurança de token

Mesmo padrão de `sync-core.ts`: token descriptografado só em memória da
invocação; nunca retornado, nunca logado, nunca persistido em claro.
Autenticação por secret PRÓPRIO (`META_BACKFILL_EXECUTOR_SECRET`,
dedicado — não reaproveita `META_SYNC_CRON_SECRET`), comparação em tempo
constante, `verify_jwt=false` (backend-only, nenhum JWT de usuário).

### Claim — nunca contorna o control plane

Sempre via RPC `claim_next_backfill_segment` (V2.2.1/V2.2.2) — a Edge
Function recebe só `{ jobId? }` opcional, NUNCA aceita `segment_id` do
chamador. 1 invocação = no máximo 1 tentativa de 1 segmento (`idle` se
nada elegível) — não planeja, não faz loop, não cria jobs, não vira Cron.

### Equivalência Current Sync × Backfill

Não existem DOIS caminhos para comparar — o Backfill reutiliza
`toDailyRows` literalmente (mesma importação). Um teste "compare os dois
caminhos" seria estruturalmente vazio. Provado em vez disso:
(1) guarda estática — os dois arquivos importam `toDailyRows` do MESMO
`_shared/insights.ts`; (2) `BackfillInsightRow` é campo-a-campo idêntico
ao `DailyInsightRow` real (comparado contra o código-fonte). Uma tentativa
de EXECUTAR `toDailyRows` dentro de um teste Vitest (possível — o arquivo
não usa nenhuma API Deno) esbarrou em `tsc --noEmit`: `supabase/functions`
está fora do `include` do `tsconfig.json`, e seus imports usam extensão
`.ts` explícita (exigida pelo Deno) — o que dispara `TS5097` assim que um
arquivo de dentro do `include` importa de lá. Corrigir exigiria
`allowImportingTsExtensions` no `tsconfig.json` (config global,
compartilhada) — decisão NÃO tomada nesta etapa (fora do pedido, efeito
maior que o valor do teste). Documentado em
`tests/backfill/normalizer-equivalence.test.ts`.

### periodic — fora do escopo (Daily Only)

`meta_insights_periodic` **não é tocada** nesta etapa. O Current Sync usa
`meta_upsert_insights_periodic` sobre agregados por `datePreset` — uma
abstração pensada para o RUNTIME OPERACIONAL (hoje/ontem/last_30d...), não
para um intervalo histórico arbitrário de um segmento de backfill (`date_from`/
`date_to` explícitos não mapeiam 1:1 para nenhum preset). Reaproveitá-la
sem uma reformulação significaria inventar uma agregação
periódica artificial — proibido explicitamente (`meta_insights_periodic
só deve ser tocada se já houver abstração naturalmente reutilizável`).
**Não há.** Fica documentado como decisão, não como pendência silenciosa.

### Gate de runtime Deno (pós-implementação)

`npm run typecheck` (Next/tsc) **não cobre** `supabase/functions` (fora do
`include` do `tsconfig.json`) — os 1160+ testes Vitest não garantiam, sozinhos,
que a Edge Function realmente compilasse no runtime Deno. Deno instalado
localmente (usuário, sem sudo, `~/.deno`) só para fechar este gate.
`deno check` em TODAS as Edge Functions (novas e pré-existentes) e em TODO
`_shared/*.ts`: **limpo**. Achado real no caminho: `_shared/crypto.ts` tinha
2 erros de tipo PRÉ-EXISTENTES (`Uint8Array` × `BufferSource`, TS 6.0.3 do
Deno atual mais estrito que quando o arquivo foi escrito) — afetavam
IGUALMENTE `meta-sync`/`meta-sync-scheduled`/`meta-oauth-exchange` já em
produção; nunca detectados porque `deno check` nunca tinha rodado neste
projeto. Corrigido (2 `as BufferSource`, aprovado explicitamente antes de
tocar — zero mudança de runtime, só satisfaz o type-checker).
`supabase/functions/_shared/insights.test.ts` (Deno nativo, 4 testes) prova
`toDailyRows` executando de verdade (não mock) — fecha a lacuna que a
tentativa via Vitest não conseguiu fechar sem tocar o `tsconfig.json` do
Next (documentado em `tests/backfill/normalizer-equivalence.test.ts`).

### O que ainda NÃO roda

Nenhuma chamada real à Meta nesta sessão (guardado por teste estático +
comportamental). Nenhum deploy da Edge Function. Nenhum Cron. Nenhum job/
segmento real criado/reivindicado em Dev. Nenhuma migration nova (o
control plane V2.2.1/V2.2.2 já aplicado no Dev foi suficiente — nenhum
estado indispensável faltando). `META_BACKFILL_EXECUTOR_SECRET` é só um
NOME de env var referenciado no código — nenhum secret configurado no
Supabase nesta sessão. `supabase/config.toml` continua não existindo —
`verify_jwt=false` é uma flag de `supabase functions deploy --no-verify-jwt`,
documentada no cabeçalho do arquivo (mesmo padrão de `meta-sync-scheduled`).

### Primeiro piloto — V2.2.3B ✅ CONCLUÍDO (Supabase Dev)

Plano original (abaixo, histórico) executado com sucesso no Supabase Dev,
fora desta sessão de implementação (piloto real, com Meta de verdade,
conexão Dev reautorizada via OAuth):

1. Supabase Dev, 1 conta linkada com conexão REAUTORIZADA (as conexões
   Dev estavam `reauthorization_required` — reautorizadas via OAuth real
   antes do piloto).
2. `level=account`, intervalo pequeno, 1 job → 1 segmento (via
   `claim_next_backfill_segment(p_job_id)`).
3. Invocação manual da Edge Function (sem Cron) — resposta conferida,
   `meta_insights_daily` conferida manualmente.
4. Idempotência confirmada: reinvocação não duplicou dados.

**Validado no piloto real:** chamada Meta de verdade, zero-data
(`skipped_no_data` quando aplicável), escrita em `meta_insights_daily`,
idempotência (natural key), ausência de duplicação. Achado do piloto que
motivou a DATA V2.2.4 (abaixo): o job ficava `running` para sempre depois
que o(s) segmento(s) terminavam — exigia `UPDATE` manual do
`meta_backfill_jobs.status` para `completed`.

`level=campaign`/`adset`/`ad` (Atacado do Chinelo, 95 ads, candidato a
teste de carga) continuam como próximos passos do piloto, fora desta
sessão.

## DATA V2.2.4 — Automatic Job Finalization

Elimina o `UPDATE` manual do job encontrado no piloto V2.2.3B.

### Schema auditado (nenhuma coluna nova)

`meta_backfill_jobs.finished_at` já existe desde a V2.2.1
(`20260910120000_meta_backfill_control_plane.sql`) e já é carimbado pela
trigger `meta_backfill_jobs_check_transition` ao entrar em `completed` —
nenhuma coluna nova foi criada. A transição `running -> completed` já era
válida na máquina de estados do job (mesma migration) — nenhuma mudança
de trigger/schema, só a RPC que decide QUANDO disparar essa transição.

### Regra final

Dentro da MESMA invocação de `complete_backfill_segment`, SE o `UPDATE`
fenced do segmento teve sucesso (`running -> done | skipped_no_data`):

```
job.status = 'running'
AND existe >= 1 segmento do job
AND nenhum segmento do job está pending/running/failed
-> job.status = 'completed'
```

Jobs `paused`/`failed`/`cancelled`/`completed`/`exhausted` nunca são
tocados (só `j.status = 'running'` participa da condição). `exhausted`
**nunca** é usado por esta regra — mesmo se todos os segmentos forem
`skipped_no_data`, o resultado é `completed` (job explícito com intervalo
definido). `exhausted` continua reservado ao fluxo futuro de discovery
("todo o histórico disponível pela fonte").

### Atomicidade

Sem segunda RPC, sem segunda transação, sem chamada extra da Edge
Function. A reconciliação do job acontece DENTRO do corpo de
`complete_backfill_segment` (`RETURNING job_id INTO v_job_id` do UPDATE
do segmento, seguido do UPDATE condicional do job), na MESMA invocação —
1 chamada da RPC = 1 transação. **Assinatura pública inalterada** (mesmos
5 parâmetros, mesmo retorno `boolean`) — a Edge Function não precisa
mudar nenhuma linha.

### Fencing preservado

Se o `UPDATE` do segmento afetar 0 linhas (token errado, lease expirada,
ou status ≠ `running`), a função devolve `false` **antes** de qualquer
tentativa de tocar no job — `get diagnostics v_n = row_count; if v_n = 0
then return false;` roda antes do `UPDATE` do job. Guardado por
parse-guard (posição relativa no SQL).

### Concorrência

Hoje só existe 1 segmento `running` por `ad_account_ref` (V2.2.2), e
1 job = 1 conta → na prática, no máximo 1 `complete_backfill_segment` "em
voo" por job a qualquer momento (segmentos do mesmo job são processados
em série). Mesmo assim, o `UPDATE` do job é condicional e idempotente —
numa hipotética concorrência futura, o pior caso é nenhuma das duas
chamadas marcar `completed` na mesma rodada (nunca uma marcação
incorreta/duplicada). Nenhum lock global novo.

### Testado como (pura, `lib/backfill/job-completion.ts`)

`shouldAutoCompleteJob(jobStatus, segmentStatuses)` espelha exatamente o
`WHERE` do UPDATE de job — testável em Vitest sem banco (a migration não
está aplicada). 11 testes: 1 segmento done/skipped → completed; done+pending/
done+running/done+failed → continua running; mix done+skipped → completed;
paused/cancelled/failed/exhausted/completed/pending → nunca altera; sem
segmentos → nunca completa.

### Edge Function

**Não alterada.** Continua chamando `complete_backfill_segment` e lendo
só o retorno `boolean` — o lifecycle do job é resolvido inteiramente pelo
banco.

## DATA V2.3A — Historical Backfill Rollout (Orchestrator + Runner)

Elimina criar job/segmentos manualmente no SQL Editor. Só intervalo
EXPLÍCITO (`--from`/`--to`) — discovery/"todo o histórico" é a DATA V2.3B.

### Arquitetura — 3 peças, 1 fonte de verdade de segmentação

```
NODE/CLI (scripts/backfill/run.ts)
  → importa lib/backfill/planner.ts#planBackfillSegments (ÚNICA fonte de
    verdade de segmentação — nenhuma cópia do algoritmo aqui nem no
    orchestrator)
  → envia SegmentPlan[] já calculado

EDGE ORCHESTRATOR (supabase/functions/meta-backfill-orchestrator/)
  → valida a FORMA do payload
  → materializa job + segmentos ATOMICAMENTE via RPC
    (create_backfill_job_with_segments — valida a SEMÂNTICA no servidor)
  → fornece inspect/status
  → NÃO busca insights Meta, NÃO executa segmento nenhum

EDGE EXECUTOR (supabase/functions/meta-backfill-executor/, V2.2.3 — INTOCADO)
  → continua executando 1 segmento por invocation, exatamente como antes
```

### `inspect`

Entrada `{clientId, adAccountRef}`. Valida cliente existe, conta pertence
ao cliente, `is_linked=true`, `connection_id` existe, `meta_connections.status
in (active, expiring)` (mesma regra de `meta_eligible_ad_accounts`),
`has_secret=true` — nunca lê o segredo em si. Devolve `entityCounts`
(campaign/adset/ad reais, via `count(*)`), `activeJob`/`jobId` (se houver),
`currentSyncRunning`. O CLI usa `entityCounts` como hint do planner
existente (`EntityCountHints`) — mesma heurística adaptativa da V2.2.2.

### `create`

Entrada `{clientId, adAccountRef, requestedLevels, targetStartDate,
targetEndDate, segments}` — `segments` é o `SegmentPlan[]` já calculado
pelo CLI. A Edge Function só valida a FORMA (level válido, dateFrom/dateTo
presentes) e chama `create_backfill_job_with_segments` — TODA validação
semântica (overlap/gap/coverage/conta/job ativo) é responsabilidade da
RPC, no servidor, que NÃO confia no payload.

### `status`

Entrada `{jobId}`. Reutiliza a view `meta_backfill_progress` (DATA
V2.2.1) — nenhum contador é recalculado/duplicado. `levels` vem de um
segundo SELECT em `meta_backfill_jobs.requested_levels` (único campo que
a view não expõe).

### RPC `create_backfill_job_with_segments` (migration nova, NÃO aplicada)

1 `meta_backfill_job` + N `meta_backfill_segments` na MESMA transação.
Se qualquer segmento for inválido: exception -> ROLLBACK TOTAL (zero job,
zero segmentos) — nenhuma exceção capturada ao redor do INSERT dos
segmentos, então uma falha ali desfaz o job que acabou de ser inserido na
MESMA chamada. Validação server-side (12 checagens): obrigatórios, faixa
válida, conta pertence ao cliente e `is_linked`, nenhum job ativo
duplicado (mais o próprio índice único parcial como rede de segurança
contra corrida), level de cada segmento pertence a `requested_levels`,
datas não invertidas, dentro do range alvo, sem duplicata, sem overlap
(self-join por level), cobertura EXATA sem gap por level solicitado
(`lag()` + limites batendo com o range alvo). Job criado direto em
`running` (pronto para `claim_next_backfill_segment`); auto-complete
(V2.2.4) cuida do fim. **Assinatura preservada, revogada de
public/anon/authenticated, só `service_role` executa.**

### CLI/Runner (`scripts/backfill/run.ts`, `npm run backfill`)

```
npm run backfill -- --client-id <uuid> --ad-account-ref <uuid> \
  --from 2026-08-01 --to 2026-09-10 --levels account,campaign,adset,ad
```

- **Dry-run é o padrão** (sem `--execute`): `inspect` → planner LOCAL →
  imprime o plano (contas/período/levels/segmentos por level) → **não
  cria job, não chama o executor, não chama a Meta**.
- **`--execute`** (obrigatório para rodar de verdade): inspect → planner →
  `create` (via orchestrator) → loop chamando o executor **1 segmento por
  vez**, nunca mais de 1 invocação "em voo".
- **`--resume <jobId>`**: NÃO cria job novo — só retoma o loop de um job
  já existente. Ctrl-C não cancela nada (nenhum handler de SIGINT toca o
  job) — o job fica exatamente como estava, persistido no banco.
- **Idle**: o executor pode responder `idle` (nada elegível agora) — NÃO
  é erro. Job `running` → aguarda (delay configurável, default 3s) e
  tenta de novo; guarda de idle consecutivo (default 10) evita loop
  infinito; job terminal (`completed/exhausted/cancelled/failed`) → para
  limpo; job `paused` → para e reporta (não espera indefinidamente por
  uma pausa manual).
- **Failure**: existe segmento `failed` → o runner PARA e reporta
  (comportamento conservador inicial — não tenta calcular
  `next_retry_at`/esperar; não esconde o erro; um scheduler de retry
  fica para uma fase futura).
- **Rate/delay**: delay configurável entre invocações do executor (default
  3s) — o executor já controla pressão de rate limit página a página; o
  runner só evita bater com força total. Sem paralelismo entre contas
  nesta etapa (rollout sequencial).
- **Dev-only**: `scripts/backfill/dev-guard.ts` recusa qualquer
  project-ref que não seja o Supabase Dev conhecido, ANTES de qualquer
  chamada de rede — Prod tem uma mensagem própria (recusado por nome).
- **Secrets**: só de env (`BACKFILL_ORCHESTRATOR_URL`,
  `META_BACKFILL_ORCHESTRATOR_SECRET`, `BACKFILL_EXECUTOR_URL`,
  `META_BACKFILL_EXECUTOR_SECRET`) — nunca aceitos via argumento de CLI,
  nunca logados.

### O que ainda NÃO faz (V2.3A)

Discovery/"todo o histórico disponível pela fonte" — `--from` é
obrigatório; sem ele, o runner recusa e explica que é a DATA V2.3B.
Paralelismo entre contas — rollout sequencial só. Scheduler de retry de
segmento `failed` — o runner para e reporta, não tenta sozinho. Nenhuma
migration aplicada, nenhum deploy da nova Edge Function, nenhum secret
remoto configurado, nenhum job real criado nesta sessão.

## DATA V2.3B — Earliest-Date Discovery + Full Historical Backfill

Permite `npm run backfill -- --all-history` — sem informar `--from`
manualmente. Nenhuma coluna/tabela nova (auditado: `meta_ad_accounts` não
guarda `created_time`; a Meta é sempre a fonte ao vivo). Nenhuma migration.

### Meta como fonte de verdade (nunca inventa data)

`earliestDate` é a primeira data em que a **Meta Ads Insights API**
retorna dado real — nunca a primeira linha no nosso banco, nunca a
primeira campanha/ad criado localmente, nunca uma constante fixa
("37 meses" ou qualquer retenção hardcoded). Discovery roda em
`level=account` (se existe insight em campaign/adset/ad numa data, o
account level da mesma conta reflete atividade naquela data também) — o
MESMO range descoberto é depois usado para todos os levels solicitados.

### Limite inferior — `accountCreatedDate`

Auditado: `meta_ad_accounts` **não** guarda `created_time` localmente (só
`timezone_name`). Sem criar coluna/tabela nova, Discovery busca
`created_time` **ao vivo** da Graph API (`getAdAccountMeta`, `_shared/
graph.ts` — `GET /{act_id}?fields=created_time,timezone_name`, 1 único
objeto, não paginado). A data é a string ISO crua da Meta (já no offset
local da conta) — nunca reprocessada via `Date`/UTC, evitando qualquer
deslocamento de dia.

### Limite superior — `latestClosedDate`

O último dia TOTALMENTE fechado no **timezone da conta** — nunca o
timezone do host, nunca UTC assumido, nunca um timezone fixo (ex.:
America/Sao_Paulo para todas as contas). Timezone preferencial: a
resposta AO VIVO da Meta (`timezone_name`, na MESMA chamada de
`created_time` — nenhum request extra); fallback ao valor local já
conhecido (`meta_ad_accounts.timezone_name`) só se a Meta omitir.
`latestClosedDate = addDays(accountToday(timezone), -1)` — reaproveita
`accountToday`/`addDays`, **extraídos** de `sync-core.ts` para
`_shared/date-util.ts` nesta etapa (refactor MÍNIMO, comportamento
IDÊNTICO, guardado por teste — o Current Sync usa exatamente a mesma
lógica desde a Auto Sync V1, agora só num arquivo compartilhado).

### Algoritmo de discovery (bounded, não escaneia dia a dia)

`discoverEarliestDate` (`lib/backfill/earliest-date-discovery.ts`, Node
puro/testado; espelho Deno REAL em `_shared/discovery-algorithm.ts`,
usado pela Edge Function):

1. **Caso feliz — O(log n):** 1 probe do range inteiro
   (`accountCreatedDate` → `latestClosedDate`). Sem dado → `no_history`
   (nenhum probe a mais). Com dado → **binary search** pela menor data
   com dado (predicado monotônico: "existe dado no prefixo
   `[lowerBound, mid]`?") — ~log2(dias) probes, nunca 1 por dia.
2. **Fallback (range REJEITADO especificamente, não qualquer erro):**
   dispara APENAS quando o probe do range inteiro falha com
   `errorKind: "range_rejected"` — classificado a partir de
   `GraphApiError.code === 100` ("Invalid parameter", o código real da
   Meta; ver "Range rejection" abaixo). Nesse caso: varredura em
   **blocos amplos** (`chunkDays`, default 180 dias / ~6 meses) do mais
   antigo para o mais novo, até achar o primeiro bloco com dado; só
   então o binary search roda, limitado a esse bloco. **QUALQUER outro
   erro** (auth, permissão, rate limit, transient, resposta malformada)
   **NUNCA** dispara o fallback — vira `probe_error` imediato, com o
   motivo original preservado (nunca mascarado como "range grande
   demais").
3. **Confirmação:** o candidato do binary search é sempre confirmado com
   1 probe do dia exato antes de virar `found` — se a confirmação falhar
   (inconsistência), o resultado é `confirmation_failed`, nunca um
   `found` forçado.
4. **Guarda `MAX_DISCOVERY_PROBES` (60, documentado):** 1 (range inteiro)
   + até ~30 blocos (pior caso ~15-20 anos / 180 dias) + ~8 probes de
   binary search + 1 confirmação ≈ 40, com folga até 60 — nunca
   excedido; ao atingir o teto, para com `probe_limit_exceeded` (nunca
   loop infinito). Um probe recusado proativamente por pressão de rate
   (ver abaixo) também conta contra este teto.

Probe mínimo: `probeAccountInsights` (`_shared/graph.ts`) pede só
`date_start`, `pageLimit:1` — basta 1 linha para responder "existe
dado?"; reaproveita `fetchEdgePage` (MESMO cliente HTTP de
`listEdge`/`listInsightsPage`), nenhuma paginação/normalização própria.

### Range rejection — classificação mínima, sem duplicar o classificador

**MICRO-AUDITORIA (pré-checkpoint):** a versão original acionava o
fallback chunked para QUALQUER erro no probe do range inteiro — amplo
demais (um erro de auth ou de rate limit não significa "range rejeitado").
Corrigido: `GraphApiError` (`_shared/graph.ts`) ganhou um campo NOVO e
opcional, `code: number | null` (o `error.code` cru da Meta) — sem ampliar
`GraphErrorKind`/`classifyGraphError` (que continuam com os MESMOS 5
valores; o executor V2.2.3 e o Current Sync, que só leem `.kind`,
permanecem intocados e compilam sem mudança — confirmado por `deno check`
+ teste Deno dedicado). Só `meta-backfill-discovery` interpreta
`code === 100` ("Invalid parameter") como `range_rejected` — a MENOR
extensão necessária, não um 2º sistema de classificação.

### Rate pressure — respeitada proativamente, não só capturada

**MICRO-AUDITORIA:** capturar `x-app-usage`/`x-ad-account-usage`
(`captureRateUsage`, automático dentro de `fetchEdgePage`) não bastava —
faltava uma DECISÃO defensiva antes de continuar disparando probes.
Corrigido: o `probe` de Discovery agora CHECA a pressão (`canRunDiscoveryNow`,
mirror local do MESMO limiar conservador de
`lib/backfill/rate-limit.ts#canRunBackfill` /
`meta-backfill-executor#canRunBackfillNow` — executor NÃO alterado) ANTES
de cada chamada real; sob pressão alta, devolve `errorKind: "rate_limited"`
sem gastar a chamada HTTP. Isso nunca aciona o fallback (só
`range_rejected` aciona) e ainda conta contra `MAX_DISCOVERY_PROBES` —
nunca dispara probes sem limite mesmo sob pressão sustentada.
`resetRateUsage()` roda antes do loop de probes (isolamento desta
invocação, mesma defesa já aplicada no executor).

### Edge Function `meta-backfill-discovery`

Responsabilidade única: descobrir. NÃO cria job/segment, NÃO escreve
insight, NÃO executa backfill, NÃO altera Current Sync — **READ-ONLY**
(nem sequer marca `meta_connections.reauthorization_required` em erro de
secret/decrypt, diferente do executor — é uma consulta exploratória, sem
efeito colateral). Auth por secret dedicado
(`META_BACKFILL_DISCOVERY_SECRET`, `x-meta-backfill-discovery-secret`,
timing-safe, sem fallback, 401, `--no-verify-jwt` documentado, sem
`config.toml`). Connection safety via `resolveEligibleAccount`
(`_shared/backfill-eligibility.ts`, NOVO helper compartilhado — mesma
regra de `meta_eligible_ad_accounts`/já usada no executor/orchestrator,
extraída para o CÓDIGO NOVO não duplicar; orchestrator/executor já
aprovados/checkpointed NÃO foram retrofitados, decisão deliberada para
não reabrir revisão de código já fechado). Token nunca retornado/logado.

### `--all-history` no runner

Mutuamente exclusivo com `--from`/`--to` (`cli-args.ts`) — nenhum dos
dois quebra o outro modo. Sem nenhum dos dois: recusa, nunca inventa
data. Fluxo: `discovery` → `inspect` → planner (mesmo
`planBackfillSegments`, literal) → resumo do plano → (dry-run: para aqui;
execute: `create` → loop V2.3A, sem mudança nenhuma no loop/executor).

**Dry-run com `--all-history`**: mensagem final é **"Discovery consultou
a Meta. Nenhum job foi criado. Nenhum segmento de backfill foi
executado."** — nunca "nenhuma chamada Meta" (Discovery de fato chamou a
Meta; só nenhum job/segmento foi criado/executado).

**`no_history`**: runner informa claramente e encerra sem criar job — em
dry-run OU execute (ambos, a decisão é a mesma: sem histórico, não há o
que planejar).

**`--resume`**: inalterado — nunca roda discovery, nunca cria job novo,
só retoma o loop de um job já existente (guardado por teste).

### `MAX_PLANNED_SEGMENTS` (2000, documentado)

Full history pode gerar muitos segmentos. Justificativa
(`scripts/backfill/segment-limits.ts`, a partir dos block sizes reais de
`lib/backfill/block-size.ts`): pior caso plausível — conta GRANDE (bloco
MÍNIMO de cada faixa) com ~20 anos de histórico, todos os 4 levels ≈ 2207
segmentos. `2000` fica deliberadamente um pouco abaixo desse teto
extremo — não é "tecnicamente impossível passar disso", é "acima disso,
um humano deve confirmar deliberadamente" (ex.: rodar por level
separado). Dry-run acima do limite só AVISA (nada é criado de qualquer
forma); `--execute` acima do limite **ABORTA antes de `create`** — zero
job criado.

### Dev-only

Mesma guarda de V2.3A (`assertDevProjectRef`) — agora também aplicada à
URL de discovery, sempre ANTES de qualquer chamada de rede. Prod
(`bmtzurlsohinqbjxcpje`) recusado por nome; só
`vqodysgxdkkvmfqyprpu` (Dev) é aceito.

### O que ainda NÃO faz (V2.3B)

Nenhuma migration nova (nenhuma coluna/tabela criada — `created_time` é
sempre buscado ao vivo). Nenhum deploy da nova Edge Function. Nenhum
secret remoto configurado. Nenhuma chamada `--all-history` real nesta
sessão. `Current Sync` inalterado (a extração de `date-util.ts` é
comportamento idêntico, guardada por teste) — coordenação V2.2.2 continua
protegendo concorrência; Discovery é read-only em relação a insights, não
compete por nenhum lock.

## Próximos blocos (ordem por dependência técnica)

`V2.1` Query Layer ✅ (paralelo, opt-in) · `V2.2A` Historical Backfill
Preflight ✅ · `V2.2.1` Backfill Control Plane ✅ (schema, Dev) ·
`V2.2.2` Planner + Executor Foundation ✅ (schema, Dev) · `V2.2.3` Real
Backfill Executor ✅ (piloto real V2.2.3B concluído no Dev) · `V2.2.4`
Automatic Job Finalization ✅ (migration local, NÃO aplicada) · `V2.3A`
Historical Backfill Rollout ✅ (orchestrator + runner, migration local NÃO
aplicada) · `V2.3B` Earliest-Date Discovery + Full History ✅ (discovery
Edge Function + `--all-history`, nenhuma migration, DEV ONLY, `--all-history`
real NÃO executado) · `V2.3` Custom ranges & reach on-demand (trilha
SEPARADA, Query Layer — numeração pré-existente, mantida) · `V2.4` Metric
catalog expansion · `V2.5`
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
- **Backfill Control Plane (DATA V2.2.1)** — aplicada e validada **só no
  Supabase Dev**; Prod permanece no schema do GO-LIVE V1. Nenhum job/segmento
  real; nenhum planner de datas; nenhum executor/Edge Function que chama a
  Meta; nenhum Cron.
- **Planner + Executor Foundation (DATA V2.2.2)** — coordenação atômica
  Current Sync × Backfill (lock + estado persistido), planner puro, discovery
  foundation, executor foundation (sem adapter real), fencing (finish/fail),
  heartbeat, retry de segmento — **migrations locais, aplicadas e validadas
  só no Dev**. Nenhum planner real gerando segmentos de um job de verdade;
  nenhum executor real chamando a Meta; nenhum Cron de backfill; nenhum
  `meta_rate_budget` persistido.
- **Real Backfill Executor (DATA V2.2.3)** — executor de 1 segmento REAL
  (paginação, heartbeat/fencing, idempotência, error classification,
  rate usage, segurança de token) construído e testado com MOCKS + `deno
  check`/`deno test` reais; Edge Function `meta-backfill-executor` criada e
  **piloto real V2.2.3B concluído no Supabase Dev** (Meta real, zero-data,
  escrita, idempotência confirmados). `meta_insights_periodic` fora do
  escopo (Daily Only — ver seção acima).
- **Automatic Job Finalization (DATA V2.2.4)** — reconciliação atômica do
  job dentro de `complete_backfill_segment`, migration local criada e
  **NÃO aplicada** (nem Dev, nem Prod). Nenhuma coluna nova, nenhuma
  mudança de trigger/máquina de estados, assinatura pública da RPC
  inalterada, Edge Function não tocada. `exhausted` continua reservado ao
  discovery futuro — não usado por esta regra.
- **Historical Backfill Rollout (DATA V2.3A)** — orchestrator
  (`meta-backfill-orchestrator`, inspect/create/status) + runner CLI
  (`scripts/backfill/run.ts`, `npm run backfill`) construídos e testados
  com fakes/mocks nesta sessão; **validada REALMENTE no Supabase Dev**
  fora desta sessão (2 jobs automáticos completos: `57fc5be7-08df-4980-
  bcbb-4f29d5fd9041` account+campaign, `003bc986-178b-4b4a-90b1-
  42a53d2e1c4f` adset+ad, ambos `2026-09-04→2026-09-10`, `completed`, sem
  erro, sem lease residual). Discovery ("todo o histórico") era a DATA
  V2.3B — agora implementada (ver seção acima) — `--all-history` real
  ainda NÃO executado.
- **Earliest-Date Discovery + Full History (DATA V2.3B)** — Edge Function
  `meta-backfill-discovery` (read-only, Meta como fonte de verdade,
  bounded/logarítmico) + `--all-history` no runner construídos e testados
  com fakes/mocks/Deno test; nenhuma migration (nenhuma coluna/tabela
  nova); `--all-history` real **NÃO executado** nesta sessão; nenhum
  deploy, nenhum secret remoto configurado.
- **Prod continua intocado por toda a DATA V2** (V2.0 a V2.3B) — Dev
  recebeu as migrations do Control Plane, da Planner + Executor
  Foundation, do Auto-Complete (V2.2.4) e da materialização atômica
  (V2.3A) — confirmado pelos 2 jobs reais do piloto V2.3A-B
  (`57fc5be7-...`, `003bc986-...`), ambos finalizados automaticamente
  (`completed`) sem intervenção manual. A migration da V2.3B (Discovery)
  **não existe** — não há schema novo nesta etapa, nada a aplicar. Nenhum
  Vault/secret/deploy de Prod tocado. Nenhuma mudança visual. Nenhuma
  mudança numérica no que já está em produção.
