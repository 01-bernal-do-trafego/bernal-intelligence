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

## Próximos blocos (ordem por dependência técnica)

`V2.1` Query Layer (paralelo, opt-in) · `V2.2` Historical Backfill · `V2.3`
Custom ranges & reach on-demand · `V2.4` Metric catalog expansion · `V2.5`
Dashboard Builder data contract + gráficos novos (backend) · `V2.6` Breakdowns ·
`V2.7` Account Financial + Alerts · `V2.8` Creative Ranking · `V2.9` Client Goals
· `V2.10` Instagram Account Insights · `V2.11` Intelligence FACTS layer · `V2.12`
Scale hardening (condicional).

## Explicitamente NÃO feito nesta etapa

- **Backfill histórico** — não implementado.
- **Particionamento de `meta_insights_daily`** — não decidido. Antes de qualquer
  backfill amplo faremos uma etapa separada de estimativa de volume + `EXPLAIN` +
  tamanho de tabelas + risco de migration.
- **Limite histórico** — **não hardcoded**. A regra conceitual é "todo o período
  disponível pela fonte"; o limite real será descoberto/validado pela
  integração, não presumido como constante (nada de "37 meses" no código).
- **`dailyHorizon`** — inalterado.
- **Instagram** — não implementado (API/permissões/tabelas/OAuth pendentes).
- **Breakdowns / saldo / alertas** — só o campo/`type` preparado, sem produtor.
- **Intelligence** — não implementada; só a base de metadados (`significanceMetric`,
  `relatedMetrics`) e o contrato `DataQuality`.
- **Nenhuma migration.** Nenhum Supabase, Edge Function, Cron, Vault, secret,
  Meta API ou deploy tocado. Nenhuma mudança visual. Nenhuma mudança numérica.
