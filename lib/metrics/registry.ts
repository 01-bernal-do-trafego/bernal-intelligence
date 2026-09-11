import type { MetricBehavior } from "@/lib/comparison";
import { actionTypesForMetric } from "@/lib/meta/action-type-map";

/**
 * Metric Registry — camada EXTENSÍVEL de métricas do Bernal Intelligence.
 *
 * Objetivo: adicionar/ajustar uma métrica = editar este arquivo (e, se for de
 * conversão, `lib/meta/action-type-map.ts`). Nada de `switch` gigante nos
 * componentes. Cada `metric` id salvo em `dashboard_configs` resolve aqui.
 *
 * Categorias:
 *  - `meta_native`  : vem direto/extraído da resposta da Meta
 *  - `calculated`   : calculada pelo Bernal sobre TOTAIS BRUTOS (nunca média
 *                     de métrica derivada)
 *  - `bernal`       : indicador próprio (fases futuras)
 */

export type MetricCategory = "meta_native" | "calculated" | "bernal";

/** Onde a métrica faz sentido. `creative_analysis` é derivado de ad+creative. */
export type MetricLevel =
  | "account"
  | "campaign"
  | "adset"
  | "ad"
  | "creative_analysis";

/** Mesmo vocabulário do editor de dashboard (lib/dashboard-config). */
export type MetricFormat = "currency" | "number" | "percent" | "decimal";

export type MetricVisualization = "line" | "area" | "bar" | "horizontal_bar";

/* ------------------------------------------------------------------ */
/* DATA FOUNDATION V2 — metadados ADITIVOS (nada abaixo remove/altera  */
/* o comportamento V1; ver docs/DATA-FOUNDATION-V2.md).                */
/* ------------------------------------------------------------------ */

/**
 * Classe MATEMÁTICA de agregação. É o que impede um consumidor futuro (query
 * layer, dashboard builder) de somar uma métrica que não pode ser somada.
 *
 *  - `additive`            : soma no tempo E entre entidades (spend, impressions,
 *                            clicks, conversões contáveis...).
 *  - `unique_non_additive` : NUNCA somar (reach, frequency, unique_*). Total de
 *                            período só de `meta_insights_periodic` no intervalo
 *                            EXATO; entre entidades, só se a Meta agregou naquele
 *                            escopo.
 *  - `ratio`               : recalcular sobre TOTAIS BRUTOS (num/den), nunca
 *                            média das taxas diárias.
 *  - `weighted_avg`        : média ponderada por um denominador de volume.
 *  - `snapshot`            : valor de um ponto no tempo (saldo, spend_cap...).
 *                            Não somar no tempo; entre entidades só por decisão
 *                            explícita da UI.
 */
export type AggregationClass =
  | "additive"
  | "unique_non_additive"
  | "ratio"
  | "weighted_avg"
  | "snapshot";

/** Unidade conceitual — orienta formatação/eixo, independente do `format` de UI. */
export type MetricUnit =
  | "currency"
  | "count"
  | "percent"
  | "decimal"
  | "duration"
  | "ratio";

/**
 * Papel que a métrica pode exercer num componente de dashboard. NÃO implementa
 * nenhum gráfico novo — só declara compatibilidade para o builder futuro.
 *  - `kpi`          : card de valor único.
 *  - `timeseries`   : série temporal (line/area/bar) — equivale às
 *                     `visualizations` atuais.
 *  - `categorical`  : fatia por dimensão/entidade (pizza/donut/barra empilhada).
 *                     Só faz sentido para métrica somável (`additive`).
 *  - `table`        : coluna de tabela/ranking.
 *  - `funnel`       : etapa de funil (só métricas de volume/evento).
 *  - `intelligence` : pode ser assunto de um diagnóstico do Intelligence.
 */
export type ChartRole =
  | "kpi"
  | "timeseries"
  | "categorical"
  | "table"
  | "funnel"
  | "intelligence";

/** Dimensões de breakdown que a métrica aceita (fase futura — nada busca isto hoje). */
export type BreakdownKey =
  | "age"
  | "gender"
  | "age_gender"
  | "country"
  | "region"
  | "publisher_platform"
  | "platform_position"
  | "impression_device";

export type MetricAvailability =
  | "stable" // sempre presente (spend, impressions, clicks...)
  | "depends_on_account" // depende de pixel/evento/objetivo/vídeo
  | "meta_in_development" // a Meta marca como beta/estimada
  | "bernal_planned"; // indicador Bernal ainda não implementado

/** De onde vem o dado bruto (em cima de meta_insights_daily / totais). */
export type MetricSource =
  | { kind: "column"; column: string }
  | {
      kind: "action";
      actionType: string | string[];
      valueKind?: "count" | "value";
    }
  | { kind: "formula"; formula: MetricFormula };

/** Fórmula declarativa (sem eval). */
export interface MetricFormula {
  op: "ratio" | "sum" | "product" | "identity";
  numerator?: string;
  denominator?: string;
  /** ratio: multiplicador (ex.: *100 p/ CTR, *1000 p/ CPM). */
  multiplier?: number;
  /** sum / product: metric ids. */
  operands?: string[];
  /** identity: metric id. */
  of?: string;
}

export type DashboardSurface = "card" | "chart" | "table" | "creative_table";

/**
 * Como obter o valor da métrica para um PERÍODO (card / total), não para um dia.
 *
 *  - `periodic_or_sum`: o total do período pode vir da soma das linhas diárias
 *    (`meta_insights_daily`) — métrica aditiva (spend, impressions, clicks,
 *    conversões...). Também pode vir de `meta_insights_periodic` (idêntico).
 *
 *  - `periodic_only`: NÃO pode ser obtida somando dias. Precisa vir de
 *    `meta_insights_periodic` (uma consulta agregada à Meta, sem
 *    `time_increment`, com as MESMAS regras do Ads Manager). Ex.: `reach`
 *    (pessoas únicas — a mesma pessoa em 2 dias conta 1 no período) e
 *    `frequency` (depende do reach do período). No gráfico temporal a versão
 *    diária continua válida ponto a ponto.
 */
export type MetricPeriodSource = "periodic_or_sum" | "periodic_only";

export interface MetricDefinition {
  id: string;
  label: string;
  description: string;
  category: MetricCategory;
  source: MetricSource;
  format: MetricFormat;
  behavior: MetricBehavior;
  /** Como agregar no tempo/entidades. `ratio` = num/den sobre totais brutos. */
  aggregation: "sum" | "ratio" | "weighted_avg" | "last" | "max";
  /** De onde vem o total de um PERÍODO (card). Ver `MetricPeriodSource`. */
  periodSource: MetricPeriodSource;
  levels: readonly MetricLevel[];
  visualizations: readonly MetricVisualization[];
  availability: MetricAvailability;
  /** Depende de um evento/pixel configurado na conta. */
  requiresEvent: boolean;
  isDerived: boolean;
  /** `results`: segue o comportamento configurado da métrica principal do cliente. */
  followsClientResultMetric?: boolean;
  /**
   * `true` = o VALOR depende de `dashboard_configs.result_metric` e é resolvido
   * EM LEITURA (ver `lib/meta/result-metric-resolve.ts`). NÃO é persistido pela
   * sincronização — `results`/`cost_per_result`. Mudar a config muda o número
   * na hora, sem novo sync.
   */
  configDriven?: boolean;
  /** Superfícies onde é exposta HOJE no editor (mantém a UI atual estável). */
  dashboardSurfaces: readonly DashboardSurface[];

  /* ---- DATA FOUNDATION V2 (aditivo) --------------------------------- */

  /**
   * Classe matemática de agregação. Fonte da verdade para "posso somar isto?".
   * Presente em toda métrica REAL (definida pelas fábricas). Ausente só num
   * placeholder de arquitetura sem semântica matemática (ex.: `performance_trend`),
   * onde `getMetricAggregationClass` devolve `null` e nenhum consumidor agrega.
   * `weighted_avg` fica reservada para quando houver um denominador de peso
   * ARMAZENADO (hoje nenhuma métrica atende — ver `lib/metrics/aggregation.ts`).
   */
  aggregationClass?: AggregationClass;
  /** Unidade conceitual (orienta eixo/formatação). */
  unit: MetricUnit;
  /** Papéis de componente que a métrica pode exercer (builder futuro). */
  chartRoles: readonly ChartRole[];
  /** `true` = pode ser ETAPA de um funil (só volume/evento; nunca ratio/reach/spend). */
  funnelEligible: boolean;
  /**
   * Dimensões de breakdown aceitas. **`[]` para todas nesta fase** — nada busca
   * nem lê breakdown ainda; o campo é preenchido no bloco DATA V2.6.
   */
  breakdownsCompatible: readonly BreakdownKey[];
  /**
   * IDs de métrica dos quais ESTA depende para ser calculada. Para fórmulas é
   * derivável dos operandos (ver `getMetricDependencies`); explicitável aqui
   * para casos não-fórmula. Consumidor: query layer (o que buscar) + Intelligence.
   */
  dependencies?: readonly string[];
  /**
   * Métrica cujo VOLUME indica se há amostra suficiente para uma conclusão
   * (ex.: CPA só é confiável com `purchases` suficientes). Base do Intelligence;
   * nenhum produtor de "insufficient_sample" nesta fase.
   */
  significanceMetric?: string;
  /**
   * Correlatos FORTES e úteis, para o contrato de FACTS do Intelligence
   * (`supportingSignals`). Só relações claras — não um grafo completo.
   */
  relatedMetrics?: readonly string[];
}

const ALL_LEVELS: readonly MetricLevel[] = [
  "account",
  "campaign",
  "adset",
  "ad",
  "creative_analysis",
];
const AD_DOWN_LEVELS: readonly MetricLevel[] = [
  "campaign",
  "adset",
  "ad",
  "creative_analysis",
];
const TS_VIS: readonly MetricVisualization[] = [
  "line",
  "area",
  "bar",
  "horizontal_bar",
];

/** Exposta no editor hoje (card + gráfico) — deve bater com dashboard-config. */
const CARD_CHART: readonly DashboardSurface[] = ["card", "chart"];
const HIDDEN: readonly DashboardSurface[] = [];

/* ------------------------------------------------------------------ */
/* Aliases (a UI de cards usa "investment"; id canônico é "spend")     */
/* ------------------------------------------------------------------ */

export const METRIC_ALIASES: Readonly<Record<string, string>> = {
  investment: "spend",
};

export function resolveMetricId(id: string): string {
  return METRIC_ALIASES[id] ?? id;
}

/* ------------------------------------------------------------------ */
/* Fábricas                                                            */
/* ------------------------------------------------------------------ */

function unitFromFormat(format: MetricFormat): MetricUnit {
  switch (format) {
    case "currency":
      return "currency";
    case "percent":
      return "percent";
    case "number":
      return "count";
    case "decimal":
      return "decimal";
  }
}

/**
 * `chartRoles` padrão a partir da classe de agregação + elegibilidade a funil.
 * `categorical` (pizza/donut/empilhada) só para métrica somável.
 */
function deriveChartRoles(
  aggregationClass: AggregationClass | undefined,
  funnelEligible: boolean,
): ChartRole[] {
  const roles: ChartRole[] = ["kpi", "timeseries", "table", "intelligence"];
  if (aggregationClass === "additive") roles.push("categorical");
  if (funnelEligible) roles.push("funnel");
  return roles;
}

/** Preenche `chartRoles` derivado quando o override não os declarou. */
function finalize(
  base: MetricDefinition,
  overrides: Partial<MetricDefinition>,
): MetricDefinition {
  const def = { ...base, ...overrides };
  if (overrides.chartRoles === undefined) {
    def.chartRoles = deriveChartRoles(def.aggregationClass, def.funnelEligible);
  }
  return def;
}

function column(
  id: string,
  label: string,
  description: string,
  format: MetricFormat,
  behavior: MetricBehavior,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return finalize(
    {
      id,
      label,
      description,
      category: "meta_native",
      source: { kind: "column", column: id },
      format,
      behavior,
      aggregation: "sum",
      periodSource: "periodic_or_sum",
      levels: ALL_LEVELS,
      visualizations: TS_VIS,
      availability: "stable",
      requiresEvent: false,
      isDerived: false,
      dashboardSurfaces: HIDDEN,
      aggregationClass: "additive",
      unit: unitFromFormat(format),
      chartRoles: [],
      funnelEligible: false,
      breakdownsCompatible: [],
    },
    overrides,
  );
}

function conversion(
  id: string,
  label: string,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return finalize(
    {
      id,
      label,
      description: `Conversões do tipo "${label}" atribuídas no período.`,
      category: "meta_native",
      source: { kind: "action", actionType: actionTypesForMetric(id) },
      format: "number",
      behavior: "higher_is_better",
      aggregation: "sum",
      periodSource: "periodic_or_sum",
      levels: ALL_LEVELS,
      visualizations: TS_VIS,
      availability: "depends_on_account",
      requiresEvent: true,
      isDerived: false,
      aggregationClass: "additive",
      unit: "count",
      chartRoles: [],
      funnelEligible: true,
      breakdownsCompatible: [],
      dashboardSurfaces: HIDDEN,
    },
    overrides,
  );
}

function formula(
  id: string,
  label: string,
  format: MetricFormat,
  behavior: MetricBehavior,
  f: MetricFormula,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return finalize(
    {
      id,
      label,
      description: `${label} calculado a partir dos totais brutos.`,
      category: "calculated",
      source: { kind: "formula", formula: f },
      format,
      behavior,
      aggregation: "ratio",
      periodSource: "periodic_or_sum",
      levels: ALL_LEVELS,
      visualizations: TS_VIS,
      availability: "stable",
      requiresEvent: false,
      isDerived: true,
      dashboardSurfaces: HIDDEN,
      aggregationClass: "ratio",
      unit: unitFromFormat(format),
      chartRoles: [],
      funnelEligible: false,
      breakdownsCompatible: [],
    },
    overrides,
  );
}

/* ------------------------------------------------------------------ */
/* Definições                                                          */
/* ------------------------------------------------------------------ */

const DEFINITIONS: readonly MetricDefinition[] = [
  // ---- meta_native: colunas fixas ----
  column("spend", "Investimento", "Valor gasto no período, na moeda da conta.", "currency", "neutral", { dashboardSurfaces: CARD_CHART, relatedMetrics: ["impressions", "cpm", "reach"] }),
  column("impressions", "Impressões", "Vezes que os anúncios foram exibidos.", "number", "higher_is_better", { dashboardSurfaces: CARD_CHART, funnelEligible: true }),
  column("reach", "Alcance", "Pessoas únicas alcançadas. Não é somável por dia — o total do período vem de consulta agregada.", "number", "higher_is_better", { aggregation: "last", periodSource: "periodic_only", aggregationClass: "unique_non_additive", dashboardSurfaces: CARD_CHART, relatedMetrics: ["impressions", "frequency"] }),
  column("clicks", "Cliques", "Todos os cliques (inclui reações, comentários etc.).", "number", "higher_is_better", { dashboardSurfaces: CARD_CHART, funnelEligible: true }),
  column("inline_link_clicks", "Cliques no link", "Cliques que levaram ao destino do anúncio.", "number", "higher_is_better", { funnelEligible: true }),
  column("video_3s_views", "Reproduções de 3s", "Reproduções de vídeo de pelo menos 3 segundos.", "number", "higher_is_better", { levels: AD_DOWN_LEVELS, availability: "depends_on_account", funnelEligible: true }),
  column("video_thruplays", "ThruPlays", "Reproduções completas ou de pelo menos 15 segundos.", "number", "higher_is_better", { levels: AD_DOWN_LEVELS, availability: "depends_on_account", funnelEligible: true }),
  // `weighted_avg` seria a classe teórica, MAS o denominador de peso correto
  // (`video_plays`) NÃO é armazenado hoje — sem ele não dá para reconstruir a
  // média entre dias/entidades. Classificada conservadoramente como
  // `unique_non_additive`: só do agregado periódico exato (comportamento V1).
  column("video_avg_time_watched", "Tempo médio assistido", "Segundos médios de vídeo assistidos.", "decimal", "higher_is_better", { aggregation: "weighted_avg", periodSource: "periodic_only", aggregationClass: "unique_non_additive", unit: "duration", levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),

  // ---- config-driven: "Resultados" resolvido em leitura (não persistido) ----
  {
    id: "results",
    label: "Resultados",
    description:
      "Conversão principal configurada para o cliente (lead, compra, conversa...). " +
      "Resolvido em leitura a partir de dashboard_configs.result_metric — não é persistido pelo sync.",
    category: "calculated",
    source: { kind: "action", actionType: "__client_result__" },
    format: "number",
    behavior: "higher_is_better",
    aggregation: "sum",
    periodSource: "periodic_or_sum",
    levels: ALL_LEVELS,
    visualizations: TS_VIS,
    availability: "depends_on_account",
    requiresEvent: true,
    isDerived: true,
    configDriven: true,
    followsClientResultMetric: true,
    dashboardSurfaces: CARD_CHART,
    aggregationClass: "additive",
    unit: "count",
    chartRoles: ["kpi", "timeseries", "table", "categorical", "funnel", "intelligence"],
    funnelEligible: true,
    breakdownsCompatible: [],
  },
  conversion("leads", "Leads"),
  conversion("purchases", "Compras", { dashboardSurfaces: CARD_CHART }),
  // Mensageria: 3 métricas DISTINTAS (não aliases) — cada uma = 1 action_type.
  // LIBERADAS no dashboard real (validadas com dados reais).
  conversion("messaging_conversations_started", "Conversas iniciadas", { dashboardSurfaces: CARD_CHART }),
  conversion("messaging_contacts_total", "Total de contatos", { dashboardSurfaces: CARD_CHART }),
  conversion("messaging_contacts_new", "Novos contatos", { dashboardSurfaces: CARD_CHART }),
  // `conversations` (legado / compat) = ponteiro para "conversas iniciadas".
  // HIDDEN: não é opção visual do editor (o id novo a substitui).
  formula("conversations", "Conversas iniciadas", "number", "higher_is_better", { op: "identity", of: "messaging_conversations_started" }, { aggregation: "sum", aggregationClass: "additive", funnelEligible: true, dashboardSurfaces: HIDDEN, availability: "depends_on_account", requiresEvent: true }),
  conversion("registrations", "Cadastros"),
  conversion("appointments", "Agendamentos"),
  conversion("add_to_cart", "Adições ao carrinho"),
  conversion("initiate_checkout", "Finalizações iniciadas"),
  conversion("landing_page_views", "Visualizações da página"),
  conversion("link_clicks", "Cliques no link (ação)"),
  {
    id: "revenue",
    label: "Receita",
    description: "Valor de conversão (compras) atribuído no período.",
    category: "meta_native",
    source: {
      kind: "action",
      actionType: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"],
      valueKind: "value",
    },
    format: "currency",
    behavior: "higher_is_better",
    aggregation: "sum",
    periodSource: "periodic_or_sum",
    levels: ALL_LEVELS,
    visualizations: TS_VIS,
    availability: "depends_on_account",
    requiresEvent: true,
    isDerived: false,
    dashboardSurfaces: CARD_CHART,
    aggregationClass: "additive",
    unit: "currency",
    chartRoles: ["kpi", "timeseries", "table", "categorical", "intelligence"],
    funnelEligible: false,
    breakdownsCompatible: [],
    relatedMetrics: ["spend", "purchases", "roas"],
  },

  // ---- calculated: fórmulas sobre totais brutos ----
  formula("ctr", "CTR", "percent", "higher_is_better", { op: "ratio", numerator: "clicks", denominator: "impressions", multiplier: 100 }, { dashboardSurfaces: CARD_CHART, significanceMetric: "impressions", relatedMetrics: ["impressions", "clicks", "cpm"] }),
  formula("ctr_link", "CTR (link)", "percent", "higher_is_better", { op: "ratio", numerator: "inline_link_clicks", denominator: "impressions", multiplier: 100 }, { significanceMetric: "impressions", relatedMetrics: ["impressions", "inline_link_clicks", "cpm"] }),
  formula("cpc", "CPC", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "clicks" }, { dashboardSurfaces: CARD_CHART, significanceMetric: "clicks", relatedMetrics: ["spend", "clicks", "ctr", "cpm"] }),
  formula("cpc_link", "CPC (link)", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "inline_link_clicks" }, { significanceMetric: "inline_link_clicks", relatedMetrics: ["spend", "inline_link_clicks", "ctr_link", "cpm"] }),
  formula("cpm", "CPM", "currency", "neutral", { op: "ratio", numerator: "spend", denominator: "impressions", multiplier: 1000 }, { dashboardSurfaces: CARD_CHART, significanceMetric: "impressions", relatedMetrics: ["spend", "impressions", "frequency", "reach"] }),
  formula("frequency", "Frequência", "decimal", "neutral", { op: "ratio", numerator: "impressions", denominator: "reach" }, { periodSource: "periodic_only", aggregationClass: "unique_non_additive", unit: "ratio", dashboardSurfaces: CARD_CHART, relatedMetrics: ["impressions", "reach"] }),
  formula("cost_per_result", "Custo por resultado", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "results" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true, configDriven: true, significanceMetric: "results", relatedMetrics: ["spend", "results", "ctr", "cpm", "frequency"] }),
  formula("cpl", "Custo por lead", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "leads" }, { availability: "depends_on_account", requiresEvent: true, significanceMetric: "leads", relatedMetrics: ["spend", "leads", "ctr", "cpm", "frequency"] }),
  formula("cpa", "CPA", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "purchases" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true, significanceMetric: "purchases", relatedMetrics: ["spend", "purchases", "ctr", "cpm", "frequency"] }),
  formula("roas", "ROAS", "decimal", "higher_is_better", { op: "ratio", numerator: "revenue", denominator: "spend" }, { unit: "ratio", dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true, significanceMetric: "purchases", relatedMetrics: ["spend", "revenue", "purchases", "cpa", "ctr"] }),
  formula("cost_per_conversation", "Custo por conversa", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "conversations" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true, significanceMetric: "conversations", relatedMetrics: ["spend", "conversations", "ctr", "cpm"] }),
  formula("hook_rate", "Hook rate", "percent", "higher_is_better", { op: "ratio", numerator: "video_3s_views", denominator: "impressions", multiplier: 100 }, { levels: AD_DOWN_LEVELS, availability: "depends_on_account", significanceMetric: "impressions", relatedMetrics: ["video_3s_views", "impressions", "thruplay_rate"] }),
  formula("thruplay_rate", "Taxa de ThruPlay", "percent", "higher_is_better", { op: "ratio", numerator: "video_thruplays", denominator: "impressions", multiplier: 100 }, { levels: AD_DOWN_LEVELS, availability: "depends_on_account", significanceMetric: "impressions", relatedMetrics: ["video_thruplays", "impressions", "hook_rate"] }),

  // ---- bernal: indicador próprio (placeholder de arquitetura) ----
  {
    id: "performance_trend",
    label: "Tendência de performance",
    description: "Indicador Bernal Intelligence — implementação em fase futura.",
    category: "bernal",
    source: { kind: "formula", formula: { op: "identity", of: "spend" } },
    format: "decimal",
    behavior: "contextual",
    aggregation: "last",
    periodSource: "periodic_or_sum",
    levels: ALL_LEVELS,
    visualizations: TS_VIS,
    availability: "bernal_planned",
    requiresEvent: false,
    isDerived: true,
    dashboardSurfaces: HIDDEN,
    // Placeholder de arquitetura (Bernal Intelligence, fase futura). NÃO é uma
    // métrica pontual (`snapshot`) nem participa de qualquer agregação hoje:
    // deliberadamente SEM `aggregationClass` -> getMetricAggregationClass()
    // devolve `null` e aggregationMethod() devolve "none".
    unit: "decimal",
    chartRoles: ["intelligence"],
    funnelEligible: false,
    breakdownsCompatible: [],
  },
];

/* ------------------------------------------------------------------ */
/* API do registry                                                     */
/* ------------------------------------------------------------------ */

const REGISTRY = new Map<string, MetricDefinition>(
  DEFINITIONS.map((d) => [d.id, d]),
);

export const METRIC_REGISTRY: readonly MetricDefinition[] = DEFINITIONS;

export function getMetricDefinition(id: string): MetricDefinition | undefined {
  return REGISTRY.get(resolveMetricId(id));
}

export function metricExists(id: string): boolean {
  return REGISTRY.has(resolveMetricId(id));
}

export function metricsByCategory(category: MetricCategory): MetricDefinition[] {
  return DEFINITIONS.filter((d) => d.category === category);
}

export function metricsForLevel(level: MetricLevel): MetricDefinition[] {
  return DEFINITIONS.filter((d) => d.levels.includes(level));
}

export function isMetricCompatibleWithLevel(
  id: string,
  level: MetricLevel,
): boolean {
  return getMetricDefinition(id)?.levels.includes(level) ?? false;
}

export function isMetricCompatibleWithVisualization(
  id: string,
  visualization: MetricVisualization,
): boolean {
  return getMetricDefinition(id)?.visualizations.includes(visualization) ?? false;
}

/**
 * `true` quando o total do período NÃO pode ser obtido somando as linhas
 * diárias — precisa vir de `meta_insights_periodic` (ex.: `reach`, `frequency`,
 * `video_avg_time_watched`). Cards/totais devem checar isto antes de somar.
 */
export function requiresPeriodicAggregate(id: string): boolean {
  return getMetricDefinition(id)?.periodSource === "periodic_only";
}

/**
 * `true` quando a métrica é ADITIVA (pode somar dias E entidades).
 *
 * DATA V2.0: passou a se basear em `aggregationClass === "additive"` (fonte da
 * verdade matemática), não mais em `aggregation === "sum"`. Para todas as
 * métricas atuais o resultado é IDÊNTICO ao anterior — nenhum número muda.
 */
export function isMetricAdditive(id: string): boolean {
  return getMetricDefinition(id)?.aggregationClass === "additive";
}

/**
 * IDs de métrica dos quais `id` depende para ser calculada. Explícito
 * (`def.dependencies`) tem prioridade; senão, deriva dos operandos da fórmula.
 * Consumidor: query layer futuro (o que buscar) + Intelligence.
 */
export function getMetricDependencies(id: string): string[] {
  const def = getMetricDefinition(id);
  if (!def) return [];
  if (def.dependencies) return [...def.dependencies];
  if (def.source.kind !== "formula") return [];
  const f = def.source.formula;
  const ids = [
    ...(f.numerator ? [f.numerator] : []),
    ...(f.denominator ? [f.denominator] : []),
    ...(f.operands ?? []),
    ...(f.of ? [f.of] : []),
  ];
  return [...new Set(ids)];
}

/**
 * Métricas cujo valor depende de `dashboard_configs.result_metric` e é
 * resolvido EM LEITURA (não persistido pelo sync). Ver
 * `lib/meta/result-metric-resolve.ts`.
 */
export const CONFIG_DRIVEN_METRIC_IDS: readonly string[] = DEFINITIONS.filter(
  (d) => d.configDriven,
).map((d) => d.id);

export function isConfigDrivenMetric(id: string): boolean {
  return getMetricDefinition(id)?.configDriven === true;
}

/** Métricas de conversão CANÔNICAS da Meta (persistidas pelo sync, 1:1 com um action_type). */
export const CANONICAL_CONVERSION_METRIC_IDS: readonly string[] = [
  "leads",
  "messaging_conversations_started",
  "messaging_contacts_total",
  "messaging_contacts_new",
  "purchases",
  "registrations",
  "appointments",
  "add_to_cart",
  "initiate_checkout",
  "landing_page_views",
  "link_clicks",
  "revenue",
];
