/**
 * Descoberta e validação de eventos de conversão. Módulo PURO.
 *
 * Alimenta a área administrativa `/clients/[id]/meta-data`:
 *  - "Eventos e conversões" — quais `action_type` a Meta devolveu, mapeados ou
 *    "requer revisão" (nunca descartados);
 *  - "Métricas de conversão (validação)" — Métrica · Valor Bernal · Fonte.
 *
 * NADA aqui vai para o dashboard principal antes da aprovação manual.
 * Regras: prioridade/fallback (sem dupla contagem); `null` (ausência) ≠ `0`.
 */

import {
  ACTION_METRIC_SPECS,
  ACTION_VALUE_METRIC_SPECS,
  actionTypesForMetric,
  bernalMetricForAction,
  bernalValueMetricForAction,
  resolveActionMetric,
  valueActionTypesForMetric,
} from "./action-type-map";
import { RESULT_METRIC_ACTION_TYPES } from "./action-type-map";
import { withResolvedResults } from "./result-metric-resolve";
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import { getMetricDefinition, type MetricFormat } from "@/lib/metrics/registry";
import type { ResultMetricType } from "@/types/domain";

export interface EventRow {
  actionType: string;
  /** contagem (de `raw_actions`); `null` se o evento só trouxe valor. */
  count: number | null;
  /** valor de conversão (de `raw_action_values`); `null` se não veio. */
  value: number | null;
  /** métrica Bernal de contagem, se mapeada. */
  bernalMetric: string | null;
  /** métrica Bernal de valor, se mapeada. */
  bernalValueMetric: string | null;
  status: "mapped" | "unmapped";
}

function asNumberMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** Lista de eventos crus com o status de mapeamento. Nunca descarta. */
export function describeEvents(
  rawActions: unknown,
  rawActionValues: unknown,
): EventRow[] {
  const counts = asNumberMap(rawActions);
  const values = asNumberMap(rawActionValues);
  const keys = new Set([...Object.keys(counts), ...Object.keys(values)]);

  const rows: EventRow[] = [...keys].map((at) => {
    const bm = bernalMetricForAction(at) ?? null;
    const bvm = bernalValueMetricForAction(at) ?? null;
    return {
      actionType: at,
      count: at in counts ? counts[at] : null,
      value: at in values ? values[at] : null,
      bernalMetric: bm,
      bernalValueMetric: bvm,
      status: bm || bvm ? "mapped" : "unmapped",
    };
  });

  return rows.sort((a, b) => {
    if ((a.status === "mapped") !== (b.status === "mapped")) {
      return a.status === "mapped" ? -1 : 1;
    }
    return (b.count ?? b.value ?? 0) - (a.count ?? a.value ?? 0);
  });
}

/** Primeiro `action_type` da lista de prioridade presente nos crus. */
function firstPresent(list: readonly string[], present: Record<string, number>): string | null {
  for (const at of list) if (at in present) return at;
  return null;
}

export interface ConversionMetricRow {
  id: string;
  label: string;
  format: MetricFormat;
  /** valor calculado sobre os totais brutos; `null` = sem fonte real. */
  value: number | null;
  /** de onde veio (action_type ou fórmula), para "Fonte/mapeamento". */
  source: string | null;
}

/** Métricas de conversão desta fase, na ordem de exibição. */
export const CONVERSION_METRIC_IDS = [
  "results",
  "cost_per_result",
  "messaging_conversations_started",
  "messaging_contacts_total",
  "messaging_contacts_new",
  "cost_per_conversation",
  "leads",
  "cpl",
  "purchases",
  "cpa",
  "revenue",
  "roas",
] as const;

/**
 * Resolve as métricas Bernal a partir dos `action_type` CRUS — fonte de
 * verdade. Reflete o `ACTION_METRIC_SPECS` ATUAL mesmo em linhas sincronizadas
 * antes de uma mudança de mapeamento (sem re-sync).
 */
function resolveCanonicalFromRaw(
  rawActions: Record<string, number>,
  rawActionValues: Record<string, number>,
): { actions: Record<string, number>; actionValues: Record<string, number> } {
  const toMap = (o: Record<string, number>) =>
    new Map<string, number>(Object.entries(o));
  const ra = toMap(rawActions);
  const rav = toMap(rawActionValues);
  const actions: Record<string, number> = {};
  for (const spec of ACTION_METRIC_SPECS) {
    const v = resolveActionMetric(spec.actionTypes, ra, spec.combine);
    if (v !== null) actions[spec.metricId] = v;
  }
  const actionValues: Record<string, number> = {};
  for (const spec of ACTION_VALUE_METRIC_SPECS) {
    const v = resolveActionMetric(spec.actionTypes, rav, spec.combine);
    if (v !== null) actionValues[spec.metricId] = v;
  }
  return { actions, actionValues };
}

/**
 * `MetricTotals` para o `computeMetric` a partir de uma linha de
 * `meta_insights_periodic` (fonte autoritativa do período).
 *
 * As métricas Bernal são RE-RESOLVIDAS a partir de `raw_actions`/
 * `raw_action_values` (fonte de verdade) — assim `/meta-data` reflete o
 * mapeamento ATUAL mesmo em linhas sincronizadas antes de uma mudança. Se
 * não houver crus, cai no `actions`/`action_values` persistido.
 */
export function conversionTotalsFromRow(row: {
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  inline_link_clicks?: unknown;
  reach?: unknown;
  frequency?: unknown;
  actions?: unknown;
  action_values?: unknown;
  raw_actions?: unknown;
  raw_action_values?: unknown;
}): MetricTotals {
  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v)
      ? v
      : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const rawActions = asNumberMap(row.raw_actions);
  const rawActionValues = asNumberMap(row.raw_action_values);
  const hasRaw =
    Object.keys(rawActions).length > 0 || Object.keys(rawActionValues).length > 0;
  const resolved = hasRaw
    ? resolveCanonicalFromRaw(rawActions, rawActionValues)
    : { actions: asNumberMap(row.actions), actionValues: asNumberMap(row.action_values) };
  return {
    spend: n(row.spend),
    impressions: n(row.impressions),
    clicks: n(row.clicks),
    inline_link_clicks: n(row.inline_link_clicks),
    reach: n(row.reach),
    frequency: n(row.frequency),
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: resolved.actions,
    actionValues: resolved.actionValues,
  };
}

/** Linhas Métrica · Valor · Fonte para a tabela de validação. */
export function buildConversionRows(args: {
  totals: MetricTotals;
  rawActions: unknown;
  rawActionValues: unknown;
  resultType?: ResultMetricType;
}): ConversionMetricRow[] {
  const rawCounts = asNumberMap(args.rawActions);
  const rawValues = asNumberMap(args.rawActionValues);
  // `results`/`cost_per_result` são resolvidos EM LEITURA a partir da config.
  const totals = withResolvedResults(args.totals, args.resultType);

  return CONVERSION_METRIC_IDS.map((id) => {
    const def = getMetricDefinition(id);
    const value = computeMetric(id, totals);
    let source: string | null = null;

    if (id === "results") {
      source = args.resultType
        ? resultMetricSource(args.resultType, args.rawActions)
        : null;
    } else if (def?.source.kind === "action") {
      if (def.source.valueKind === "value") {
        source =
          firstPresent(valueActionTypesForMetric(id), rawValues) ??
          (id === "revenue" ? "action_value" : null);
      } else {
        source = firstPresent(actionTypesForMetric(id), rawCounts);
      }
    } else if (def?.source.kind === "formula") {
      const f = def.source.formula;
      source =
        f.op === "ratio" && f.numerator && f.denominator
          ? `${f.numerator} / ${f.denominator}`
          : "cálculo";
    }

    return {
      id,
      label: def?.label ?? id,
      format: def?.format ?? "number",
      value,
      source: value === null ? null : source,
    };
  });
}

/** `action_type`(s) que resolvem o resultado principal do cliente. */
export function resultMetricSource(
  resultType: ResultMetricType,
  rawActions: unknown,
): string | null {
  return firstPresent(RESULT_METRIC_ACTION_TYPES[resultType] ?? [], asNumberMap(rawActions));
}
