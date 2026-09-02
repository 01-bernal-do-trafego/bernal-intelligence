import { safeDivide } from "@/lib/metrics";
import {
  getMetricDefinition,
  type MetricFormula,
} from "./registry";

/**
 * Avaliação de uma métrica do registry sobre TOTAIS BRUTOS.
 *
 * Regra central: fórmulas operam sempre sobre os totais (soma de colunas
 * brutas + soma de conversões), NUNCA sobre médias de métricas derivadas.
 * `null` = ausência de fonte (propaga); `safeDivide` já protege contra
 * `NaN`/`Infinity` e divisão por zero (retorna 0).
 */

export interface MetricTotals {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  frequency: number | null;
  video_3s_views: number | null;
  video_thruplays: number | null;
  video_avg_time_watched: number | null;
  /** id de métrica Bernal -> contagem somada. */
  actions: Record<string, number>;
  /** id de métrica de valor Bernal -> valor somado. */
  actionValues: Record<string, number>;
}

export function emptyTotals(): MetricTotals {
  return {
    spend: null,
    impressions: null,
    reach: null,
    clicks: null,
    inline_link_clicks: null,
    frequency: null,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function computeMetric(
  metricId: string,
  totals: MetricTotals,
  seen: ReadonlySet<string> = new Set(),
): number | null {
  const def = getMetricDefinition(metricId);
  if (!def) return null;
  if (seen.has(def.id)) return null; // proteção contra ciclo em fórmulas
  const nextSeen = new Set(seen).add(def.id);

  switch (def.source.kind) {
    case "column": {
      return num((totals as unknown as Record<string, unknown>)[def.source.column]);
    }
    case "action": {
      const bag =
        def.source.valueKind === "value" ? totals.actionValues : totals.actions;
      return num(bag[def.id]);
    }
    case "formula": {
      return evalFormula(def.source.formula, totals, nextSeen);
    }
  }
}

function evalFormula(
  f: MetricFormula,
  totals: MetricTotals,
  seen: ReadonlySet<string>,
): number | null {
  switch (f.op) {
    case "ratio": {
      const numerator = f.numerator
        ? computeMetric(f.numerator, totals, seen)
        : null;
      const denominator = f.denominator
        ? computeMetric(f.denominator, totals, seen)
        : null;
      if (numerator === null || denominator === null) return null;
      return safeDivide(numerator, denominator) * (f.multiplier ?? 1);
    }
    case "sum": {
      const values = (f.operands ?? [])
        .map((id) => computeMetric(id, totals, seen))
        .filter((v): v is number => v !== null);
      return values.length === 0
        ? null
        : values.reduce((acc, v) => acc + v, 0);
    }
    case "product": {
      const values = (f.operands ?? []).map((id) =>
        computeMetric(id, totals, seen),
      );
      if (values.some((v) => v === null)) return null;
      return (values as number[]).reduce((acc, v) => acc * v, 1);
    }
    case "identity": {
      return f.of ? computeMetric(f.of, totals, seen) : null;
    }
  }
}
