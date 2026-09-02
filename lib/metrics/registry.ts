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

function column(
  id: string,
  label: string,
  description: string,
  format: MetricFormat,
  behavior: MetricBehavior,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return {
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
    ...overrides,
  };
}

function conversion(
  id: string,
  label: string,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return {
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
    dashboardSurfaces: HIDDEN,
    ...overrides,
  };
}

function formula(
  id: string,
  label: string,
  format: MetricFormat,
  behavior: MetricBehavior,
  f: MetricFormula,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  return {
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
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Definições                                                          */
/* ------------------------------------------------------------------ */

const DEFINITIONS: readonly MetricDefinition[] = [
  // ---- meta_native: colunas fixas ----
  column("spend", "Investimento", "Valor gasto no período, na moeda da conta.", "currency", "neutral", { dashboardSurfaces: CARD_CHART }),
  column("impressions", "Impressões", "Vezes que os anúncios foram exibidos.", "number", "higher_is_better", { dashboardSurfaces: CARD_CHART }),
  column("reach", "Alcance", "Pessoas únicas alcançadas. Não é somável por dia — o total do período vem de consulta agregada.", "number", "higher_is_better", { aggregation: "last", periodSource: "periodic_only", dashboardSurfaces: CARD_CHART }),
  column("clicks", "Cliques", "Todos os cliques (inclui reações, comentários etc.).", "number", "higher_is_better", { dashboardSurfaces: CARD_CHART }),
  column("inline_link_clicks", "Cliques no link", "Cliques que levaram ao destino do anúncio.", "number", "higher_is_better"),
  column("video_3s_views", "Reproduções de 3s", "Reproduções de vídeo de pelo menos 3 segundos.", "number", "higher_is_better", { levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),
  column("video_thruplays", "ThruPlays", "Reproduções completas ou de pelo menos 15 segundos.", "number", "higher_is_better", { levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),
  column("video_avg_time_watched", "Tempo médio assistido", "Segundos médios de vídeo assistidos.", "decimal", "higher_is_better", { aggregation: "weighted_avg", periodSource: "periodic_only", levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),

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
  },
  conversion("leads", "Leads"),
  conversion("purchases", "Compras", { dashboardSurfaces: CARD_CHART }),
  conversion("conversations", "Conversas", { dashboardSurfaces: CARD_CHART }),
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
  },

  // ---- calculated: fórmulas sobre totais brutos ----
  formula("ctr", "CTR", "percent", "higher_is_better", { op: "ratio", numerator: "clicks", denominator: "impressions", multiplier: 100 }, { dashboardSurfaces: CARD_CHART }),
  formula("ctr_link", "CTR (link)", "percent", "higher_is_better", { op: "ratio", numerator: "inline_link_clicks", denominator: "impressions", multiplier: 100 }),
  formula("cpc", "CPC", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "clicks" }, { dashboardSurfaces: CARD_CHART }),
  formula("cpc_link", "CPC (link)", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "inline_link_clicks" }),
  formula("cpm", "CPM", "currency", "neutral", { op: "ratio", numerator: "spend", denominator: "impressions", multiplier: 1000 }, { dashboardSurfaces: CARD_CHART }),
  formula("frequency", "Frequência", "decimal", "neutral", { op: "ratio", numerator: "impressions", denominator: "reach" }, { periodSource: "periodic_only", dashboardSurfaces: CARD_CHART }),
  formula("cost_per_result", "Custo por resultado", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "results" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true, configDriven: true }),
  formula("cpl", "Custo por lead", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "leads" }, { availability: "depends_on_account", requiresEvent: true }),
  formula("cpa", "CPA", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "purchases" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true }),
  formula("roas", "ROAS", "decimal", "higher_is_better", { op: "ratio", numerator: "revenue", denominator: "spend" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true }),
  formula("cost_per_conversation", "Custo por conversa", "currency", "lower_is_better", { op: "ratio", numerator: "spend", denominator: "conversations" }, { dashboardSurfaces: CARD_CHART, availability: "depends_on_account", requiresEvent: true }),
  formula("hook_rate", "Hook rate", "percent", "higher_is_better", { op: "ratio", numerator: "video_3s_views", denominator: "impressions", multiplier: 100 }, { levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),
  formula("thruplay_rate", "Taxa de ThruPlay", "percent", "higher_is_better", { op: "ratio", numerator: "video_thruplays", denominator: "impressions", multiplier: 100 }, { levels: AD_DOWN_LEVELS, availability: "depends_on_account" }),

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

/** `true` quando a métrica é aditiva no tempo (pode somar dias). */
export function isMetricAdditive(id: string): boolean {
  return getMetricDefinition(id)?.aggregation === "sum";
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

/** Métricas de conversão CANÔNICAS da Meta (persistidas pelo sync). */
export const CANONICAL_CONVERSION_METRIC_IDS: readonly string[] = [
  "leads",
  "conversations",
  "purchases",
  "registrations",
  "appointments",
  "add_to_cart",
  "initiate_checkout",
  "landing_page_views",
  "link_clicks",
  "revenue",
];
