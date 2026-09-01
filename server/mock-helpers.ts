import { isWithin, type DateRange } from "@/lib/date-range";
import { aggregateMetrics, type AggregatedMetrics } from "@/lib/metrics";
import type { DailyMetric } from "@/types/domain";

export function withinRange(
  rows: readonly DailyMetric[],
  range: DateRange,
): DailyMetric[] {
  return rows.filter((row) => isWithin(range, row.date));
}

export interface DailyTotal {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  reach: number;
}

/**
 * Totais por dia para todos os dias da faixa (dias sem dados => zeros),
 * na ordem cronológica.
 */
export function dailyTotals(
  rows: readonly DailyMetric[],
  days: readonly string[],
): DailyTotal[] {
  const map = new Map<string, DailyTotal>();
  for (const date of days) {
    map.set(date, {
      date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      results: 0,
      reach: 0,
    });
  }
  for (const row of rows) {
    const total = map.get(row.date);
    if (!total) continue;
    total.spend += row.spend;
    total.impressions += row.impressions;
    total.clicks += row.clicks;
    total.results += row.results;
    total.reach += row.reach;
  }
  return days.map((date) => map.get(date) as DailyTotal);
}

export function aggregate(rows: readonly DailyMetric[]): AggregatedMetrics {
  return aggregateMetrics(rows);
}
