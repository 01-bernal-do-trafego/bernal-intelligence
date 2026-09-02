import type { MetricBehavior } from "@/lib/comparison";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import type { ResultMetricConfig, ResultMetricType } from "@/types/domain";

/**
 * Configuração de dashboard por cliente — salva em `public.dashboard_configs`
 * (colunas `result_metric` e `layout`).
 *
 * `layout` está na **version 2**: cards e colunas continuam como listas
 * `{ key, enabled }`; gráficos evoluíram para objetos genéricos
 * `{ id, metric, visualization, title, enabled }` (ordem = posição no array).
 * Configurações antigas (version 1, ou sem version) são migradas na leitura.
 *
 * NADA aqui é específico de um cliente.
 */

/* ================================================================== */
/* Métrica principal                                                   */
/* ================================================================== */

export const RESULT_METRIC_TYPES: readonly ResultMetricType[] = [
  "leads",
  "purchases",
  "conversations",
  "registrations",
  "appointments",
  "results",
  "custom",
];

export const RESULT_METRIC_TYPE_LABEL: Record<ResultMetricType, string> = {
  leads: "Leads",
  purchases: "Compras",
  conversations: "Conversas",
  registrations: "Cadastros",
  appointments: "Agendamentos",
  results: "Resultados",
  custom: "Personalizado",
};

export const METRIC_BEHAVIORS: readonly MetricBehavior[] = [
  "higher_is_better",
  "lower_is_better",
  "neutral",
  "contextual",
];

export const METRIC_BEHAVIOR_LABEL: Record<MetricBehavior, string> = {
  higher_is_better: "Quanto maior, melhor",
  lower_is_better: "Quanto menor, melhor",
  neutral: "Neutro",
  contextual: "Depende do contexto",
};

const RESULT_METRIC_TYPE_SET = new Set<string>(RESULT_METRIC_TYPES);
const METRIC_BEHAVIOR_SET = new Set<string>(METRIC_BEHAVIORS);

/* ================================================================== */
/* Catálogo de métricas de gráfico                                     */
/* ================================================================== */

export type ChartContext = "time_series" | "category" | "composition";

export type ChartMetricFormat = "currency" | "number" | "percent" | "decimal";

export interface ChartMetricEntry {
  key: string;
  label: string;
  context: ChartContext;
  format: ChartMetricFormat;
  behavior: MetricBehavior;
  /** "results" segue o comportamento configurado da métrica principal. */
  usesResultMetricBehavior?: boolean;
  /** Sem fonte de dados até a integração Meta Ads. */
  requiresMeta?: boolean;
  /** Chave da série diária em ClientDashboardData.series (quando há fonte). */
  seriesKey?: string;
}

export const CHART_METRIC_CATALOG: readonly ChartMetricEntry[] = [
  { key: "spend", label: "Investimento", context: "time_series", format: "currency", behavior: "neutral", seriesKey: "spend" },
  { key: "results", label: "Resultados", context: "time_series", format: "number", behavior: "higher_is_better", usesResultMetricBehavior: true, seriesKey: "results" },
  { key: "cost_per_result", label: "Custo por resultado", context: "time_series", format: "currency", behavior: "lower_is_better", seriesKey: "cost_per_result" },
  { key: "reach", label: "Alcance", context: "time_series", format: "number", behavior: "higher_is_better", seriesKey: "reach" },
  { key: "impressions", label: "Impressões", context: "time_series", format: "number", behavior: "higher_is_better", seriesKey: "impressions" },
  { key: "clicks", label: "Cliques", context: "time_series", format: "number", behavior: "higher_is_better", seriesKey: "clicks" },
  { key: "ctr", label: "CTR", context: "time_series", format: "percent", behavior: "higher_is_better", seriesKey: "ctr" },
  { key: "cpc", label: "CPC", context: "time_series", format: "currency", behavior: "lower_is_better", seriesKey: "cpc" },
  { key: "cpm", label: "CPM", context: "time_series", format: "currency", behavior: "neutral", seriesKey: "cpm" },
  { key: "frequency", label: "Frequência", context: "time_series", format: "decimal", behavior: "neutral", seriesKey: "frequency" },
  // Dependentes da futura integração Meta Ads (sem fonte por enquanto):
  { key: "purchases", label: "Compras", context: "time_series", format: "number", behavior: "higher_is_better", requiresMeta: true },
  { key: "cpa", label: "CPA", context: "time_series", format: "currency", behavior: "lower_is_better", requiresMeta: true },
  { key: "revenue", label: "Receita", context: "time_series", format: "currency", behavior: "higher_is_better", requiresMeta: true },
  { key: "roas", label: "ROAS", context: "time_series", format: "decimal", behavior: "higher_is_better", requiresMeta: true },
  { key: "conversations", label: "Conversas", context: "time_series", format: "number", behavior: "higher_is_better", requiresMeta: true },
  { key: "cost_per_conversation", label: "Custo por conversa", context: "time_series", format: "currency", behavior: "lower_is_better", requiresMeta: true },
];

const CHART_METRIC_BY_KEY = new Map(CHART_METRIC_CATALOG.map((m) => [m.key, m]));

export function chartMetricEntry(key: string): ChartMetricEntry | undefined {
  return CHART_METRIC_BY_KEY.get(key);
}

export function chartMetricLabel(key: string): string {
  return CHART_METRIC_BY_KEY.get(key)?.label ?? key;
}

/** Métricas que já têm fonte de dados (selecionáveis no editor). */
export const AVAILABLE_CHART_METRICS = CHART_METRIC_CATALOG.filter(
  (m) => !m.requiresMeta,
);

/* ================================================================== */
/* Catálogo de visualizações + compatibilidade                         */
/* ================================================================== */

export type VisualizationType =
  | "line"
  | "area"
  | "bar"
  | "horizontal_bar"
  | "stacked_bar"
  | "combo"
  | "pie"
  | "donut";

export interface VisualizationEntry {
  key: VisualizationType;
  label: string;
  /** Contextos de dados onde a visualização faz sentido. */
  contexts: ChartContext[];
  /** Já renderizável com Recharts nesta fase. */
  implemented: boolean;
}

export const VISUALIZATION_CATALOG: readonly VisualizationEntry[] = [
  { key: "line", label: "Linha", contexts: ["time_series"], implemented: true },
  { key: "area", label: "Área", contexts: ["time_series"], implemented: true },
  { key: "bar", label: "Barras verticais", contexts: ["time_series", "category"], implemented: true },
  { key: "horizontal_bar", label: "Barras horizontais", contexts: ["category"], implemented: true },
  // Futuras — arquitetura preparada, ainda não implementadas:
  { key: "stacked_bar", label: "Barras empilhadas", contexts: ["category", "composition"], implemented: false },
  { key: "combo", label: "Combinado", contexts: ["time_series"], implemented: false },
  { key: "pie", label: "Pizza", contexts: ["composition"], implemented: false },
  { key: "donut", label: "Rosca", contexts: ["composition"], implemented: false },
];

const VISUALIZATION_BY_KEY = new Map(
  VISUALIZATION_CATALOG.map((v) => [v.key, v]),
);

export function visualizationLabel(key: string): string {
  return VISUALIZATION_BY_KEY.get(key as VisualizationType)?.label ?? key;
}

/** Visualizações compatíveis e já implementadas para uma métrica. */
export function compatibleVisualizations(metricKey: string): VisualizationType[] {
  const metric = CHART_METRIC_BY_KEY.get(metricKey);
  if (!metric) return [];
  return VISUALIZATION_CATALOG.filter(
    (v) => v.implemented && v.contexts.includes(metric.context),
  ).map((v) => v.key);
}

/** Métrica + visualização formam uma combinação válida (com fonte de dados)? */
export function isChartCombinationValid(
  metricKey: string,
  visualization: string,
): boolean {
  const metric = CHART_METRIC_BY_KEY.get(metricKey);
  const viz = VISUALIZATION_BY_KEY.get(visualization as VisualizationType);
  if (!metric || !viz || !viz.implemented) return false;
  if (metric.requiresMeta) return false;
  return viz.contexts.includes(metric.context);
}

export function defaultChartTitle(metricKey: string): string {
  const metric = CHART_METRIC_BY_KEY.get(metricKey);
  if (!metric) return "Gráfico";
  return metric.context === "time_series"
    ? `${metric.label} ao longo do tempo`
    : metric.label;
}

/* ================================================================== */
/* Catálogos de cards e colunas (inalterados)                          */
/* ================================================================== */

export interface CatalogEntry {
  key: string;
  label: string;
  requiresMeta?: boolean;
}

export const CARD_CATALOG: readonly CatalogEntry[] = [
  { key: "investment", label: "Investimento" },
  { key: "results", label: "Resultados" },
  { key: "cost_per_result", label: "Custo por resultado" },
  { key: "reach", label: "Alcance" },
  { key: "impressions", label: "Impressões" },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "frequency", label: "Frequência" },
  { key: "purchases", label: "Compras", requiresMeta: true },
  { key: "cpa", label: "CPA", requiresMeta: true },
  { key: "revenue", label: "Receita", requiresMeta: true },
  { key: "roas", label: "ROAS", requiresMeta: true },
  { key: "conversations", label: "Conversas", requiresMeta: true },
  { key: "cost_per_conversation", label: "Custo por conversa", requiresMeta: true },
];

export const TABLE_COLUMN_CATALOG: readonly CatalogEntry[] = [
  { key: "campaign", label: "Campanha" },
  { key: "status", label: "Status" },
  { key: "investment", label: "Investimento" },
  { key: "results", label: "Resultados" },
  { key: "cost_per_result", label: "Custo por resultado" },
  { key: "reach", label: "Alcance" },
  { key: "impressions", label: "Impressões" },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
];

export const REQUIRED_TABLE_COLUMN = "campaign";

const CARD_KEYS = new Map(CARD_CATALOG.map((c) => [c.key, c]));
const COLUMN_KEYS = new Map(TABLE_COLUMN_CATALOG.map((c) => [c.key, c]));

/* ================================================================== */
/* Shape                                                               */
/* ================================================================== */

export interface LayoutItem {
  key: string;
  enabled: boolean;
}

export interface ChartConfig {
  id: string;
  metric: string;
  visualization: VisualizationType;
  title: string;
  enabled: boolean;
}

export interface DashboardLayout {
  version: 2;
  cards: LayoutItem[];
  charts: ChartConfig[];
  tableColumns: LayoutItem[];
}

export interface DashboardConfigValue {
  resultMetric: ResultMetricConfig;
  layout: DashboardLayout;
}

export const MAX_CHARTS = 12;

/* ================================================================== */
/* Configuração padrão segura                                          */
/* ================================================================== */

const DEFAULT_ENABLED_CARDS = ["investment", "results", "cost_per_result", "reach"];
const DEFAULT_ENABLED_COLUMNS = [
  "campaign",
  "investment",
  "results",
  "cost_per_result",
  "ctr",
  "cpm",
  "status",
];

const DEFAULT_CHARTS: readonly ChartConfig[] = [
  { id: "chart_results", metric: "results", visualization: "area", title: "Resultados ao longo do tempo", enabled: true },
  { id: "chart_spend", metric: "spend", visualization: "area", title: "Investimento ao longo do tempo", enabled: true },
  { id: "chart_cpr", metric: "cost_per_result", visualization: "line", title: "Custo por resultado", enabled: true },
];

function cloneDefaultCharts(): ChartConfig[] {
  return DEFAULT_CHARTS.map((c) => ({ ...c }));
}

function buildList(
  catalog: readonly CatalogEntry[],
  enabledInOrder: readonly string[],
): LayoutItem[] {
  const catalogKeys = new Set(catalog.map((c) => c.key));
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const key of enabledInOrder) {
    const entry = catalog.find((c) => c.key === key);
    if (!entry || seen.has(key) || entry.requiresMeta) continue;
    items.push({ key, enabled: true });
    seen.add(key);
  }
  for (const entry of catalog) {
    if (!seen.has(entry.key) && catalogKeys.has(entry.key)) {
      items.push({ key: entry.key, enabled: false });
      seen.add(entry.key);
    }
  }
  return items;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfigValue = {
  resultMetric: RESULT_METRIC_PRESETS.results,
  layout: {
    version: 2,
    cards: buildList(CARD_CATALOG, DEFAULT_ENABLED_CARDS),
    charts: cloneDefaultCharts(),
    tableColumns: buildList(TABLE_COLUMN_CATALOG, DEFAULT_ENABLED_COLUMNS),
  },
};

/* ================================================================== */
/* Normalização de partes                                              */
/* ================================================================== */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeResultMetric(raw: unknown): ResultMetricConfig {
  const rec = asRecord(raw);
  const typeRaw = rec?.type;
  const type: ResultMetricType = RESULT_METRIC_TYPE_SET.has(String(typeRaw))
    ? (typeRaw as ResultMetricType)
    : "results";
  const preset = RESULT_METRIC_PRESETS[type];

  const labelRaw = rec?.resultLabel;
  const resultLabel =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 60)
      : preset.resultLabel;

  const costRaw = rec?.costLabel;
  const costLabel =
    typeof costRaw === "string" && costRaw.trim().length > 0
      ? costRaw.trim().slice(0, 60)
      : preset.costLabel;

  const behaviorRaw = rec?.behavior;
  const behavior: MetricBehavior = METRIC_BEHAVIOR_SET.has(String(behaviorRaw))
    ? (behaviorRaw as MetricBehavior)
    : preset.behavior;

  return { type, resultLabel, costLabel, behavior };
}

interface NormalizeListOptions {
  requiredKey?: string;
}

function normalizeList(
  raw: unknown,
  catalog: readonly CatalogEntry[],
  fallbackEnabled: readonly string[],
  options: NormalizeListOptions = {},
): LayoutItem[] {
  const catalogByKey = new Map(catalog.map((c) => [c.key, c]));
  const requestedOrder: string[] = [];
  const enabledSet = new Set<string>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const rec = asRecord(entry);
      const key = rec?.key;
      if (typeof key !== "string" || !catalogByKey.has(key)) continue;
      if (requestedOrder.includes(key)) continue;
      requestedOrder.push(key);
      if (rec?.enabled === true && !catalogByKey.get(key)?.requiresMeta) {
        enabledSet.add(key);
      }
    }
  }

  const enabledInOrder =
    requestedOrder.length > 0
      ? requestedOrder.filter((k) => enabledSet.has(k))
      : [...fallbackEnabled];

  let items = buildList(catalog, enabledInOrder);

  if (requestedOrder.length > 0) {
    const rank = new Map(requestedOrder.map((k, i) => [k, i]));
    items = [...items].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const ra = rank.has(a.key) ? (rank.get(a.key) as number) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? (rank.get(b.key) as number) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  if (options.requiredKey) {
    const key = options.requiredKey;
    items = items.filter((i) => i.key !== key);
    items.unshift({ key, enabled: true });
  }

  return items;
}

/* ---------------- gráficos: migração v1 e normalização v2 ---------- */

const V1_CHART_MIGRATION: Record<
  string,
  { metric: string; visualization: VisualizationType }
> = {
  results_over_time: { metric: "results", visualization: "area" },
  investment_over_time: { metric: "spend", visualization: "area" },
  cost_per_result_over_time: { metric: "cost_per_result", visualization: "line" },
  reach_over_time: { metric: "reach", visualization: "area" },
  impressions_over_time: { metric: "impressions", visualization: "area" },
  clicks_over_time: { metric: "clicks", visualization: "area" },
  ctr_over_time: { metric: "ctr", visualization: "line" },
  cpc_over_time: { metric: "cpc", visualization: "line" },
  cpm_over_time: { metric: "cpm", visualization: "line" },
};

function migratedV1Title(
  key: string,
  metricKey: string,
  resultMetric: ResultMetricConfig,
): string {
  if (key === "results_over_time")
    return `${resultMetric.resultLabel} ao longo do tempo`;
  if (key === "cost_per_result_over_time") return resultMetric.costLabel;
  return defaultChartTitle(metricKey);
}

/** version 1 (charts como { key, enabled }) -> ChartConfig[] preservando ordem. */
function migrateV1Charts(
  raw: unknown,
  resultMetric: ResultMetricConfig,
): ChartConfig[] {
  if (!Array.isArray(raw)) return cloneDefaultCharts();
  const out: ChartConfig[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    const rec = asRecord(entry);
    const key = typeof rec?.key === "string" ? rec.key : "";
    const mapping = V1_CHART_MIGRATION[key];
    if (!mapping || rec?.enabled !== true) continue; // só o que estava visível
    let id = key;
    if (seenIds.has(id)) id = `chart_${out.length}`;
    seenIds.add(id);
    out.push({
      id,
      metric: mapping.metric,
      visualization: mapping.visualization,
      title: migratedV1Title(key, mapping.metric, resultMetric),
      enabled: true,
    });
  }
  return out;
}

/** version 2 leniente: descarta métricas/visualizações desconhecidas. */
function normalizeCharts(raw: unknown): ChartConfig[] {
  if (!Array.isArray(raw)) return cloneDefaultCharts();
  const out: ChartConfig[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length && out.length < MAX_CHARTS; i++) {
    const rec = asRecord(raw[i]);
    if (!rec) continue;
    const metric = chartMetricEntry(
      typeof rec.metric === "string" ? rec.metric : "",
    );
    if (!metric) continue;

    const compatible = compatibleVisualizations(metric.key);
    const wanted = typeof rec.visualization === "string" ? rec.visualization : "";
    const visualization: VisualizationType = (compatible as string[]).includes(
      wanted,
    )
      ? (wanted as VisualizationType)
      : (compatible[0] ?? "area");

    const titleRaw = typeof rec.title === "string" ? rec.title.trim() : "";
    const title =
      titleRaw.length > 0 ? titleRaw.slice(0, 80) : defaultChartTitle(metric.key);

    let id =
      typeof rec.id === "string" && rec.id.trim().length > 0
        ? rec.id.trim().slice(0, 40)
        : "";
    if (!id || seenIds.has(id)) id = `chart_${i}`;
    seenIds.add(id);

    out.push({
      id,
      metric: metric.key,
      visualization,
      title,
      enabled: rec.enabled === true,
    });
  }
  return out;
}

/* ================================================================== */
/* Leitura leniente (nunca lança) — migra version 1 automaticamente    */
/* ================================================================== */

export interface RawDashboardConfig {
  result_metric?: unknown;
  layout?: unknown;
}

export function parseDashboardConfig(
  raw: RawDashboardConfig | null | undefined,
): DashboardConfigValue {
  const layoutRec = asRecord(raw?.layout);
  const resultMetric = normalizeResultMetric(raw?.result_metric);
  const version = Number(layoutRec?.version);

  const charts =
    version === 2
      ? normalizeCharts(layoutRec?.charts)
      : migrateV1Charts(layoutRec?.charts, resultMetric);

  return {
    resultMetric,
    layout: {
      version: 2,
      cards: normalizeList(layoutRec?.cards, CARD_CATALOG, DEFAULT_ENABLED_CARDS),
      charts,
      tableColumns: normalizeList(
        layoutRec?.tableColumns,
        TABLE_COLUMN_CATALOG,
        DEFAULT_ENABLED_COLUMNS,
        { requiredKey: REQUIRED_TABLE_COLUMN },
      ),
    },
  };
}

/* ================================================================== */
/* Validação estrita (para salvar)                                     */
/* ================================================================== */

export type SanitizeResult =
  | { ok: true; value: DashboardConfigValue }
  | { ok: false; error: string };

function validateStrictList(
  raw: unknown,
  catalogKeys: Map<string, CatalogEntry>,
  label: string,
): string | null {
  if (!Array.isArray(raw)) return `Configuração de ${label} inválida.`;
  for (const entry of raw) {
    const rec = asRecord(entry);
    const key = rec?.key;
    if (typeof key !== "string" || !catalogKeys.has(key)) {
      return `Item de ${label} não permitido: "${String(key)}".`;
    }
    if (typeof rec?.enabled !== "boolean") {
      return `Estado de "${key}" inválido em ${label}.`;
    }
    if (rec.enabled === true && catalogKeys.get(key)?.requiresMeta) {
      return `"${catalogKeys.get(key)?.label}" depende da integração com a Meta e não pode ser ativado agora.`;
    }
  }
  return null;
}

const CHART_ALLOWED_KEYS = new Set([
  "id",
  "metric",
  "visualization",
  "title",
  "enabled",
]);

function validateCharts(raw: unknown): string | null {
  if (!Array.isArray(raw)) return "Configuração de gráficos inválida.";
  if (raw.length > MAX_CHARTS) {
    return `São permitidos no máximo ${MAX_CHARTS} gráficos.`;
  }
  const ids = new Set<string>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) return "Gráfico inválido.";
    for (const k of Object.keys(rec)) {
      if (!CHART_ALLOWED_KEYS.has(k)) {
        return `Campo desconhecido em gráfico: "${k}".`;
      }
    }
    const metric = chartMetricEntry(
      typeof rec.metric === "string" ? rec.metric : "",
    );
    if (!metric) {
      return `Métrica de gráfico não permitida: "${String(rec.metric)}".`;
    }
    if (metric.requiresMeta) {
      return `"${metric.label}" ficará disponível após a integração com a Meta Ads.`;
    }
    const viz = VISUALIZATION_BY_KEY.get(
      typeof rec.visualization === "string"
        ? (rec.visualization as VisualizationType)
        : ("" as VisualizationType),
    );
    if (!viz || !viz.implemented) {
      return `Tipo de gráfico não permitido: "${String(rec.visualization)}".`;
    }
    if (!isChartCombinationValid(metric.key, viz.key)) {
      return `"${viz.label}" não é compatível com "${metric.label}".`;
    }
    if (typeof rec.title !== "string" || rec.title.trim().length === 0) {
      return "Todo gráfico precisa de um título.";
    }
    if (rec.title.trim().length > 80) {
      return "Título de gráfico muito longo (máx. 80 caracteres).";
    }
    if (typeof rec.enabled !== "boolean") {
      return "Estado (ativo/inativo) de gráfico inválido.";
    }
    if (typeof rec.id !== "string" || rec.id.trim().length === 0) {
      return "Gráfico sem identificador.";
    }
    if (ids.has(rec.id)) return "Há gráficos com identificador duplicado.";
    ids.add(rec.id);
  }
  return null;
}

export function sanitizeDashboardConfigInput(raw: unknown): SanitizeResult {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, error: "Configuração inválida." };

  const rm = asRecord(rec.resultMetric);
  if (!rm) return { ok: false, error: "Métrica principal inválida." };
  if (!RESULT_METRIC_TYPE_SET.has(String(rm.type))) {
    return { ok: false, error: "Tipo de métrica principal não permitido." };
  }
  if (typeof rm.resultLabel !== "string" || rm.resultLabel.trim().length === 0) {
    return { ok: false, error: "Informe o nome exibido da métrica principal." };
  }
  if (!METRIC_BEHAVIOR_SET.has(String(rm.behavior))) {
    return { ok: false, error: "Comportamento da métrica inválido." };
  }

  const layout = asRecord(rec.layout);
  if (!layout) return { ok: false, error: "Layout inválido." };

  const cardError = validateStrictList(layout.cards, CARD_KEYS, "cards");
  if (cardError) return { ok: false, error: cardError };

  const chartError = validateCharts(layout.charts);
  if (chartError) return { ok: false, error: chartError };

  const columnError = validateStrictList(
    layout.tableColumns,
    COLUMN_KEYS,
    "colunas",
  );
  if (columnError) return { ok: false, error: columnError };

  const columns = layout.tableColumns as { key: string; enabled: boolean }[];
  const campaign = columns.find((c) => c.key === REQUIRED_TABLE_COLUMN);
  if (!campaign || campaign.enabled !== true) {
    return { ok: false, error: 'A coluna "Campanha" é obrigatória.' };
  }

  // Tudo validado — monta o valor canônico (não depende de detecção de versão).
  const chartsInput = layout.charts as Record<string, unknown>[];
  const charts: ChartConfig[] = chartsInput.map((c) => ({
    id: String(c.id).trim().slice(0, 40),
    metric: String(c.metric),
    visualization: c.visualization as VisualizationType,
    title: String(c.title).trim().slice(0, 80),
    enabled: c.enabled === true,
  }));

  return {
    ok: true,
    value: {
      resultMetric: normalizeResultMetric(rec.resultMetric),
      layout: {
        version: 2,
        cards: normalizeList(layout.cards, CARD_CATALOG, DEFAULT_ENABLED_CARDS),
        charts,
        tableColumns: normalizeList(
          layout.tableColumns,
          TABLE_COLUMN_CATALOG,
          DEFAULT_ENABLED_COLUMNS,
          { requiredKey: REQUIRED_TABLE_COLUMN },
        ),
      },
    },
  };
}

/* ================================================================== */
/* Helpers de edição                                                   */
/* ================================================================== */

export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return list;
  }
  const next = [...list];
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  return next;
}

export function toggleItem(list: LayoutItem[], key: string): LayoutItem[] {
  return list.map((item) =>
    item.key === key ? { ...item, enabled: !item.enabled } : item,
  );
}

export function catalogLabel(
  catalog: readonly CatalogEntry[],
  key: string,
): string {
  return catalog.find((c) => c.key === key)?.label ?? key;
}

export function enabledKeys(items: readonly LayoutItem[]): string[] {
  return items.filter((i) => i.enabled).map((i) => i.key);
}

/** Chave do card -> chave da métrica em ClientDashboardData.metrics. */
export const CARD_METRIC_KEY: Record<string, string> = {
  investment: "investment",
  results: "results",
  cost_per_result: "cost_per_result",
  reach: "reach",
  impressions: "impressions",
  clicks: "clicks",
  ctr: "ctr",
  cpc: "cpc",
  cpm: "cpm",
  frequency: "frequency",
};

export function cardLabel(key: string, metric: ResultMetricConfig): string {
  if (key === "results") return metric.resultLabel;
  if (key === "cost_per_result") return metric.costLabel;
  return catalogLabel(CARD_CATALOG, key);
}

/* ---- gráficos ---- */

export function newChartId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) ??
    Math.random().toString(36).slice(2, 12);
  return `chart_${rand}`;
}

export function newChartConfig(metricKey = "spend"): ChartConfig {
  const entry = chartMetricEntry(metricKey);
  const metric =
    entry && !entry.requiresMeta
      ? metricKey
      : (AVAILABLE_CHART_METRICS[0]?.key ?? "spend");
  const compatible = compatibleVisualizations(metric);
  return {
    id: newChartId(),
    metric,
    visualization: compatible[0] ?? "area",
    title: defaultChartTitle(metric),
    enabled: true,
  };
}

export function addChart(charts: ChartConfig[], metricKey?: string): ChartConfig[] {
  if (charts.length >= MAX_CHARTS) return charts;
  return [...charts, newChartConfig(metricKey)];
}

export function removeChart(charts: ChartConfig[], id: string): ChartConfig[] {
  return charts.filter((c) => c.id !== id);
}

export function updateChart(
  charts: ChartConfig[],
  id: string,
  patch: Partial<Omit<ChartConfig, "id">>,
): ChartConfig[] {
  return charts.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/**
 * Troca a métrica de um gráfico ajustando a visualização se ficou
 * incompatível e o título se ainda era o padrão da métrica anterior.
 */
export function changeChartMetric(
  charts: ChartConfig[],
  id: string,
  metricKey: string,
): ChartConfig[] {
  const entry = chartMetricEntry(metricKey);
  if (!entry || entry.requiresMeta) return charts;
  return charts.map((c) => {
    if (c.id !== id) return c;
    const compatible = compatibleVisualizations(metricKey);
    const visualization = compatible.includes(c.visualization)
      ? c.visualization
      : (compatible[0] ?? c.visualization);
    const wasDefaultTitle = c.title.trim() === defaultChartTitle(c.metric);
    const title = wasDefaultTitle ? defaultChartTitle(metricKey) : c.title;
    return { ...c, metric: metricKey, visualization, title };
  });
}
