/**
 * Métricas de conversão LIBERADAS no dashboard real. Módulo PURO.
 *
 * Fase atual: só mensageria validada com dados reais —
 *   results, cost_per_result (CONFIG-DRIVEN — seguem `result_metric`),
 *   messaging_conversations_started, cost_per_conversation,
 *   messaging_contacts_total, messaging_contacts_new.
 *
 * `results` NUNCA é persistido: é resolvido em leitura a partir da métrica
 * canônica configurada em `dashboard_configs.result_metric.type`.
 *
 * Regras (iguais às da validação /meta-data):
 *  - valor sobre TOTAIS BRUTOS do intervalo (nunca média de custos diários);
 *  - `null` (evento ausente) ≠ `0` (evento medido com zero);
 *  - custo diário = spend do dia / resultado do dia (para a série);
 *  - card do período = spend total / resultado total.
 */

import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import {
  resolveCostPerResult,
  resolveResults,
} from "@/lib/meta/result-metric-resolve";
import type { ResultMetricType } from "@/types/domain";

export const RELEASED_CONVERSION_METRICS = [
  "results",
  "cost_per_result",
  "messaging_conversations_started",
  "cost_per_conversation",
  "messaging_contacts_total",
  "messaging_contacts_new",
] as const;
export type ReleasedConversionMetric =
  (typeof RELEASED_CONVERSION_METRICS)[number];

export interface ConversionMetricMeta {
  format: "number" | "currency";
  /** "quanto maior/menor melhor" — `results` usa o do `result_metric`. */
  behavior: "higher_is_better" | "lower_is_better";
  followsResultMetricBehavior?: boolean;
}

export const CONVERSION_METRIC_META: Record<
  ReleasedConversionMetric,
  ConversionMetricMeta
> = {
  results: {
    format: "number",
    behavior: "higher_is_better",
    followsResultMetricBehavior: true,
  },
  cost_per_result: { format: "currency", behavior: "lower_is_better" },
  messaging_conversations_started: {
    format: "number",
    behavior: "higher_is_better",
  },
  cost_per_conversation: { format: "currency", behavior: "lower_is_better" },
  messaging_contacts_total: { format: "number", behavior: "higher_is_better" },
  messaging_contacts_new: { format: "number", behavior: "higher_is_better" },
};

/**
 * Valor de uma métrica de conversão liberada sobre `totals` (período OU dia).
 * `results`/`cost_per_result` vêm da config (`resultType`); as demais do
 * Registry. `null` quando não há fonte real.
 */
export function conversionMetricValue(
  id: ReleasedConversionMetric,
  totals: MetricTotals,
  resultType: ResultMetricType | null | undefined,
): number | null {
  if (id === "results") return resolveResults(totals, resultType);
  if (id === "cost_per_result") return resolveCostPerResult(totals, resultType);
  return computeMetric(id, totals);
}

/** Soma vários mapas `{ action_type -> valor }` num único (ex.: dias/contas). */
export function sumRawMaps(
  maps: Iterable<unknown>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    if (!m || typeof m !== "object") continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = (out[k] ?? 0) + n;
    }
  }
  return out;
}
