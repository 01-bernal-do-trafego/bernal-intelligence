/**
 * Cálculo de métricas de mídia paga.
 *
 * Regra de ouro: métricas derivadas (CTR, CPC, CPM, custo por resultado)
 * NUNCA são obtidas pela média de métricas derivadas diárias. Sempre se
 * somam os totais brutos (investimento, impressões, cliques, resultados)
 * e só então se calcula a razão.
 */

export interface MetricTotals {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
}

export interface DailyMetricRow extends MetricTotals {
  date: string;
  reach: number;
}

export interface AggregatedMetrics extends MetricTotals {
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpr: number;
}

/** Divisão protegida: retorna 0 em vez de NaN/Infinity. */
export function safeDivide(numerator: number, denominator: number): number {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return 0;
  }
  return numerator / denominator;
}

/** CTR (%) = cliques / impressões * 100 */
export function ctr(t: Pick<MetricTotals, "clicks" | "impressions">): number {
  return safeDivide(t.clicks, t.impressions) * 100;
}

/** CPC = investimento / cliques */
export function cpc(t: Pick<MetricTotals, "spend" | "clicks">): number {
  return safeDivide(t.spend, t.clicks);
}

/** CPM = investimento / impressões * 1000 */
export function cpm(t: Pick<MetricTotals, "spend" | "impressions">): number {
  return safeDivide(t.spend, t.impressions) * 1000;
}

/** Custo por resultado = investimento / resultados */
export function costPerResult(t: Pick<MetricTotals, "spend" | "results">): number {
  return safeDivide(t.spend, t.results);
}

const EMPTY_TOTALS: MetricTotals & { reach: number } = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  results: 0,
  reach: 0,
};

/** Soma linhas diárias em totais brutos. */
export function sumRows(
  rows: readonly DailyMetricRow[],
): MetricTotals & { reach: number } {
  return rows.reduce(
    (acc, row) => ({
      spend: acc.spend + row.spend,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      results: acc.results + row.results,
      reach: acc.reach + row.reach,
    }),
    { ...EMPTY_TOTALS },
  );
}

/** Totais brutos + métricas derivadas calculadas sobre os totais. */
export function aggregateMetrics(
  rows: readonly DailyMetricRow[],
): AggregatedMetrics {
  const totals = sumRows(rows);
  return {
    ...totals,
    ctr: ctr(totals),
    cpc: cpc(totals),
    cpm: cpm(totals),
    cpr: costPerResult(totals),
  };
}
