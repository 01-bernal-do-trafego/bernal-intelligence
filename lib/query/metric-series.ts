/**
 * DATA FOUNDATION V2.1 — Query Layer. `resolveMetricSeries`. Módulo PURO.
 *
 * Série temporal DIÁRIA de N métricas para um escopo.
 *
 *   additive                  -> valor do dia = soma das entidades do escopo
 *                                naquele dia.
 *   ratio                     -> RECALCULADO sobre os componentes daquele
 *                                MESMO dia (nunca a métrica em si somada/
 *                                mediada entre dias).
 *   exact_periodic_only       -> `reach`/`frequency`/`video_avg_time_watched`
 *                                PODEM aparecer como o valor NATIVO daquele
 *                                dia (a linha diária já traz um `reach` real
 *                                da Meta para aquele dia, aquela entidade) —
 *                                mas SÓ quando o escopo é 1 entidade. O que é
 *                                proibido é usar esses pontos para reconstruir
 *                                um TOTAL do período por soma — para isso
 *                                existe `resolveMetricTotals` (periódico
 *                                exato). Com escopo multi-entidade, mesmo o
 *                                ponto diário fica indisponível (`null`): não
 *                                existe "reach diário de 3 contas" sem a Meta
 *                                agregar, então nem o ponto é inventado.
 *
 * Dia sem nenhuma linha -> TODAS as métricas daquele dia são `null`
 * (ausência), nunca `0`. Dia com linha e valor real 0 -> `0`.
 */
import { computeMetric } from "@/lib/metrics/compute";
import { getMetricDefinition, resolveMetricId } from "@/lib/metrics/registry";
import { eachDay } from "@/lib/date-range";
import { buildMetricTotals, scopedDedupedDailyRows } from "./rows";
import { assertValidRange } from "./metric-totals";
import { getDataQuality, type DataQualityInput } from "@/lib/data-quality";
import type {
  DateRange,
  MetricSeriesResult,
  NormalizedDailyRow,
  QueryScope,
  ResultMetricContext,
  SeriesPoint,
} from "./types";

export interface ResolveMetricSeriesInput {
  scope: QueryScope;
  range: DateRange;
  metricIds: readonly string[];
  dailyRows: readonly NormalizedDailyRow[];
  resultMetric?: ResultMetricContext["resultMetric"];
  dataQuality?: Partial<DataQualityInput>;
}

function valuesForDay(
  dayRows: readonly NormalizedDailyRow[],
  metricIds: readonly string[],
  scopeSize: number,
  resultMetric: ResultMetricContext["resultMetric"] | undefined,
): Record<string, number | null> {
  const resolvedIds = metricIds.map(resolveMetricId);

  if (dayRows.length === 0) {
    // ausência de linha -> null para toda métrica, nunca 0.
    return Object.fromEntries(resolvedIds.map((id) => [id, null]));
  }

  // não-aditivas: valor NATIVO do dia, só quando o escopo é 1 entidade —
  // nunca somado/reconstruído entre entidades.
  const nonAdditive =
    scopeSize === 1 && dayRows.length === 1
      ? {
          reach: dayRows[0].reach,
          frequency: dayRows[0].frequency,
          video_avg_time_watched: dayRows[0].video_avg_time_watched,
        }
      : null;

  const totals = buildMetricTotals({ rows: dayRows, nonAdditive, resultMetric });

  const out: Record<string, number | null> = {};
  for (const id of resolvedIds) {
    out[id] = getMetricDefinition(id) ? computeMetric(id, totals) : null;
  }
  return out;
}

export function resolveMetricSeries(
  input: ResolveMetricSeriesInput,
): MetricSeriesResult {
  assertValidRange(input.range);

  const scoped = scopedDedupedDailyRows(
    input.dailyRows,
    input.scope,
    input.range,
  );

  const byDate = new Map<string, NormalizedDailyRow[]>();
  for (const row of scoped) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }

  const days = eachDay({ start: input.range.from, end: input.range.to });
  const points: SeriesPoint[] = days.map((date) => ({
    date,
    values: valuesForDay(
      byDate.get(date) ?? [],
      input.metricIds,
      input.scope.entityIds.length,
      input.resultMetric,
    ),
  }));

  const quality = getDataQuality({
    ...input.dataQuality,
    hasRows: input.dataQuality?.hasRows ?? scoped.length > 0,
  });

  return { range: input.range, points, quality };
}
