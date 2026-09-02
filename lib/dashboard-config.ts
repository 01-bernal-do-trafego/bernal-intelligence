import type { MetricBehavior } from "@/lib/comparison";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import type { ResultMetricConfig, ResultMetricType } from "@/types/domain";

/**
 * Configuração de dashboard por cliente — o que é salvo em
 * `public.dashboard_configs` (colunas `result_metric` e `layout`).
 *
 * Regras centrais:
 * - toda `key` de card/gráfico/coluna vem de um catálogo fechado;
 * - a ordem é a ordem do array; `enabled` liga/desliga;
 * - a coluna "Campanha" é obrigatória (sempre presente, ativa e primeira);
 * - métricas `requiresMeta` (dependem da integração Meta) nunca ficam ativas.
 *
 * NADA aqui é específico de um cliente: A pode mostrar Leads/CPL, B Compras/CPA.
 */

/* ------------------------------------------------------------------ */
/* Métrica principal                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Catálogos (conjuntos fechados)                                      */
/* ------------------------------------------------------------------ */

export interface CatalogEntry {
  key: string;
  label: string;
  /** Depende da integração com a Meta Ads — não pode ser ativado ainda. */
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

export const CHART_CATALOG: readonly CatalogEntry[] = [
  { key: "results_over_time", label: "Resultados ao longo do tempo" },
  { key: "investment_over_time", label: "Investimento ao longo do tempo" },
  { key: "cost_per_result_over_time", label: "Custo por resultado" },
  { key: "reach_over_time", label: "Alcance" },
  { key: "impressions_over_time", label: "Impressões" },
  { key: "clicks_over_time", label: "Cliques" },
  { key: "ctr_over_time", label: "CTR" },
  { key: "cpc_over_time", label: "CPC" },
  { key: "cpm_over_time", label: "CPM" },
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
const CHART_KEYS = new Map(CHART_CATALOG.map((c) => [c.key, c]));
const COLUMN_KEYS = new Map(TABLE_COLUMN_CATALOG.map((c) => [c.key, c]));

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export interface LayoutItem {
  key: string;
  enabled: boolean;
}

export interface DashboardLayout {
  version: 1;
  cards: LayoutItem[];
  charts: LayoutItem[];
  tableColumns: LayoutItem[];
}

export interface DashboardConfigValue {
  resultMetric: ResultMetricConfig;
  layout: DashboardLayout;
}

/* ------------------------------------------------------------------ */
/* Configuração padrão segura                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_ENABLED_CARDS = [
  "investment",
  "results",
  "cost_per_result",
  "reach",
];
const DEFAULT_ENABLED_CHARTS = [
  "results_over_time",
  "investment_over_time",
  "cost_per_result_over_time",
];
const DEFAULT_ENABLED_COLUMNS = [
  "campaign",
  "investment",
  "results",
  "cost_per_result",
  "ctr",
  "cpm",
  "status",
];

/** Monta a lista: ativas na ordem dada, depois o resto do catálogo desativado. */
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
    version: 1,
    cards: buildList(CARD_CATALOG, DEFAULT_ENABLED_CARDS),
    charts: buildList(CHART_CATALOG, DEFAULT_ENABLED_CHARTS),
    tableColumns: buildList(TABLE_COLUMN_CATALOG, DEFAULT_ENABLED_COLUMNS),
  },
};

/* ------------------------------------------------------------------ */
/* Normalização de partes                                              */
/* ------------------------------------------------------------------ */

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

  // Fallback quando não veio nada aproveitável.
  const enabledInOrder =
    requestedOrder.length > 0
      ? requestedOrder.filter((k) => enabledSet.has(k))
      : [...fallbackEnabled];

  let items = buildList(catalog, enabledInOrder);

  // Reordena a parte desativada seguindo a ordem pedida (quando houver).
  if (requestedOrder.length > 0) {
    const rank = new Map(requestedOrder.map((k, i) => [k, i]));
    items = [...items].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const ra = rank.has(a.key) ? (rank.get(a.key) as number) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? (rank.get(b.key) as number) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  // Coluna obrigatória: sempre presente, ativa e primeira.
  if (options.requiredKey) {
    const key = options.requiredKey;
    items = items.filter((i) => i.key !== key);
    items.unshift({ key, enabled: true });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Leitura leniente (nunca lança)                                      */
/* ------------------------------------------------------------------ */

export interface RawDashboardConfig {
  result_metric?: unknown;
  layout?: unknown;
}

export function parseDashboardConfig(
  raw: RawDashboardConfig | null | undefined,
): DashboardConfigValue {
  const layoutRec = asRecord(raw?.layout);
  return {
    resultMetric: normalizeResultMetric(raw?.result_metric),
    layout: {
      version: 1,
      cards: normalizeList(layoutRec?.cards, CARD_CATALOG, DEFAULT_ENABLED_CARDS),
      charts: normalizeList(
        layoutRec?.charts,
        CHART_CATALOG,
        DEFAULT_ENABLED_CHARTS,
      ),
      tableColumns: normalizeList(
        layoutRec?.tableColumns,
        TABLE_COLUMN_CATALOG,
        DEFAULT_ENABLED_COLUMNS,
        { requiredKey: REQUIRED_TABLE_COLUMN },
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Validação estrita (para salvar)                                     */
/* ------------------------------------------------------------------ */

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
  const chartError = validateStrictList(layout.charts, CHART_KEYS, "gráficos");
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

  // Passou nas checagens estritas — normaliza para o formato canônico.
  return { ok: true, value: parseDashboardConfig({
    result_metric: rec.resultMetric,
    layout: rec.layout,
  }) };
}

/* ------------------------------------------------------------------ */
/* Helpers de edição (usados no editor)                                */
/* ------------------------------------------------------------------ */

export function moveItem(list: LayoutItem[], index: number, dir: -1 | 1): LayoutItem[] {
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

/* ------------------------------------------------------------------ */
/* Mapa card/gráfico -> métrica/série (para renderizar dinamicamente)  */
/* ------------------------------------------------------------------ */

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

export interface ChartMapping {
  /** Chave da série em ClientDashboardData.series. */
  series: string;
  format: "currency" | "number";
  behavior: MetricBehavior;
  /** Usa o comportamento configurado da métrica principal. */
  usesMetricBehavior?: boolean;
}

export const CHART_MAPPING: Record<string, ChartMapping> = {
  results_over_time: {
    series: "results",
    format: "number",
    behavior: "higher_is_better",
    usesMetricBehavior: true,
  },
  investment_over_time: { series: "spend", format: "currency", behavior: "neutral" },
  cost_per_result_over_time: {
    series: "cost_per_result",
    format: "currency",
    behavior: "lower_is_better",
  },
  reach_over_time: { series: "reach", format: "number", behavior: "higher_is_better" },
  impressions_over_time: {
    series: "impressions",
    format: "number",
    behavior: "higher_is_better",
  },
  clicks_over_time: { series: "clicks", format: "number", behavior: "higher_is_better" },
  ctr_over_time: { series: "ctr", format: "number", behavior: "higher_is_better" },
  cpc_over_time: { series: "cpc", format: "currency", behavior: "lower_is_better" },
  cpm_over_time: { series: "cpm", format: "currency", behavior: "neutral" },
};

export function chartTitle(key: string, metric: ResultMetricConfig): string {
  if (key === "results_over_time")
    return `${metric.resultLabel} ao longo do tempo`;
  if (key === "cost_per_result_over_time") return metric.costLabel;
  return catalogLabel(CHART_CATALOG, key);
}
