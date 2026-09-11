/**
 * DATA FOUNDATION V2.1 — Query Layer. Filtragem, dedupe e soma de linhas
 * normalizadas. Módulo PURO — nenhum acesso a banco aqui (ver
 * `InsightsReader` em `types.ts` para o contrato de um adapter real).
 *
 * Filtro defensivo: mesmo que o chamador já tenha buscado exatamente
 * `client_id`/`level`/intervalo/entidade no banco (é isso que um adapter real
 * DEVE fazer — nunca `select *` sem range), esta camada refiltra antes de
 * agregar. É uma rede de segurança barata contra um adapter com bug — não
 * substitui um `WHERE` eficiente na query real.
 */
import { dedupeByAttribution } from "@/lib/meta/insights-attribution";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import { sumRawMaps } from "@/lib/meta/dashboard-conversions";
import { withResolvedResults } from "@/lib/meta/result-metric-resolve";
import type { MetricTotals } from "@/lib/metrics/compute";
import type { ResultMetricType } from "@/types/domain";
import type {
  DateRange,
  NormalizedDailyRow,
  NormalizedPeriodicRow,
  QueryScope,
} from "./types";

/** Linhas diárias dentro do escopo (cliente/nível/entidades) e do intervalo. */
export function filterDailyRows(
  rows: readonly NormalizedDailyRow[],
  scope: QueryScope,
  range: DateRange,
): NormalizedDailyRow[] {
  const entitySet = new Set(scope.entityIds);
  return rows.filter(
    (r) =>
      r.client_id === scope.clientId &&
      r.level === scope.level &&
      entitySet.has(r.entity_id) &&
      r.date >= range.from &&
      r.date <= range.to,
  );
}

/** Linhas periódicas dentro do escopo (sem filtrar por intervalo — a seleção
 * do intervalo EXATO é responsabilidade de `selectAuthoritativePeriodicRow`). */
export function filterPeriodicRows(
  rows: readonly NormalizedPeriodicRow[],
  scope: QueryScope,
): NormalizedPeriodicRow[] {
  const entitySet = new Set(scope.entityIds);
  return rows.filter(
    (r) => r.client_id === scope.clientId && r.level === scope.level && entitySet.has(r.entity_id),
  );
}

/** Escopo + intervalo + de-dup de atribuição — usado por totais e por série. */
export function scopedDedupedDailyRows(
  rows: readonly NormalizedDailyRow[],
  scope: QueryScope,
  range: DateRange,
): NormalizedDailyRow[] {
  const scoped = filterDailyRows(rows, scope, range);
  return dedupeByAttribution(scoped, (r) => `${r.entity_id}|${r.date}`);
}

export interface AdditiveColumnBag {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  video_3s_views: number | null;
  video_thruplays: number | null;
}

function sumOrNull(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null; // nenhuma linha -> ausência, NUNCA zero
  return present.reduce((acc, v) => acc + v, 0);
}

/** Soma as colunas ADITIVAS das linhas dadas. Ausência de linha -> `null`, nunca `0`. */
export function sumAdditiveColumns(
  rows: readonly NormalizedDailyRow[],
): AdditiveColumnBag {
  return {
    spend: sumOrNull(rows.map((r) => r.spend)),
    impressions: sumOrNull(rows.map((r) => r.impressions)),
    clicks: sumOrNull(rows.map((r) => r.clicks)),
    inline_link_clicks: sumOrNull(rows.map((r) => r.inline_link_clicks)),
    video_3s_views: sumOrNull(rows.map((r) => r.video_3s_views)),
    video_thruplays: sumOrNull(rows.map((r) => r.video_thruplays)),
  };
}

/** Componentes NÃO-aditivos (`reach`/`frequency`/`video_avg_time_watched`) de
 * UMA fonte autoritativa exata — nunca somados, nunca aproximados. */
export interface NonAdditiveSource {
  reach: number | null;
  frequency: number | null;
  video_avg_time_watched: number | null;
}

/**
 * Monta o `MetricTotals` (contrato de `lib/metrics/compute.ts#computeMetric`)
 * a partir de linhas diárias JÁ escopadas/dedupe'd + uma fonte não-aditiva
 * exata opcional. Reaproveita EXATAMENTE os helpers do V1
 * (`conversionTotalsFromRow`, `sumRawMaps`, `withResolvedResults`) — sem
 * duplicar a resolução de conversão a partir de `raw_actions`.
 */
export function buildMetricTotals(args: {
  rows: readonly NormalizedDailyRow[];
  nonAdditive?: NonAdditiveSource | null;
  resultMetric?: ResultMetricType | null;
}): MetricTotals {
  const bag = sumAdditiveColumns(args.rows);
  const rawActions = sumRawMaps(args.rows.map((r) => r.raw_actions ?? {}));
  const rawActionValues = sumRawMaps(
    args.rows.map((r) => r.raw_action_values ?? {}),
  );

  const base = conversionTotalsFromRow({
    spend: bag.spend,
    impressions: bag.impressions,
    clicks: bag.clicks,
    inline_link_clicks: bag.inline_link_clicks,
    reach: args.nonAdditive?.reach ?? null,
    frequency: args.nonAdditive?.frequency ?? null,
    raw_actions: rawActions,
    raw_action_values: rawActionValues,
  });

  const totals: MetricTotals = {
    ...base,
    video_3s_views: bag.video_3s_views,
    video_thruplays: bag.video_thruplays,
    video_avg_time_watched: args.nonAdditive?.video_avg_time_watched ?? null,
  };

  return withResolvedResults(totals, args.resultMetric ?? null);
}
