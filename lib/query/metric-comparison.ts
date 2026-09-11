/**
 * DATA FOUNDATION V2.1 — Query Layer. Comparison Foundation. Módulo PURO.
 *
 * NÃO reimplementa `lib/comparison.ts` — `percentChange` já protege contra
 * `previous = 0` (devolve `null`, nunca `Infinity`) e valores não-finitos.
 * Esta camada só acrescenta a semântica NULL-SAFE que faltava: `current`/
 * `previous` ausentes (métrica indisponível no período) -> delta `null`, sem
 * lançar exceção nem inventar `0`.
 *
 * NÃO implementa UI de comparação nem deriva o período anterior — quem chama
 * fornece as duas listas já resolvidas (`resolveMetricTotals` do período
 * atual e do período anterior).
 */
import { percentChange } from "@/lib/comparison";
import type { MetricComparisonResult, MetricValueResult } from "./types";

/**
 * Compara dois valores (já resolvidos) de UMA métrica.
 *   - `current` ou `previous` `null` -> `deltaAbs`/`deltaPct` `null`.
 *   - `previous === 0` -> `deltaPct` `null` (nunca `Infinity`) — via `percentChange`.
 */
export function compareMetricValues(
  current: number | null,
  previous: number | null,
): Pick<MetricComparisonResult, "current" | "previous" | "deltaAbs" | "deltaPct"> {
  if (current === null || previous === null) {
    return { current, previous, deltaAbs: null, deltaPct: null };
  }
  return {
    current,
    previous,
    deltaAbs: current - previous,
    deltaPct: percentChange(current, previous),
  };
}

/**
 * Combina duas listas de `MetricValueResult` (período atual e anterior, MESMO
 * conjunto conceitual de `metricIds`) numa comparação por métrica. Métrica
 * ausente do lado anterior conta como `previous: null` (nunca `0`).
 */
export function resolveMetricComparison(
  current: readonly MetricValueResult[],
  previous: readonly MetricValueResult[],
): MetricComparisonResult[] {
  const previousByMetric = new Map(previous.map((r) => [r.metricId, r.value]));
  return current.map((cur) => {
    const prevValue = previousByMetric.get(cur.metricId) ?? null;
    return { metricId: cur.metricId, ...compareMetricValues(cur.value, prevValue) };
  });
}
