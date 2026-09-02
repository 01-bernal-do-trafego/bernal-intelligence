import "server-only";

import { eachDay, type PeriodPreset } from "@/lib/date-range";
import { compareMetric, type Comparison, type MetricBehavior } from "@/lib/comparison";
import { safeDivide } from "@/lib/metrics";
import { getDemoPerformance } from "@/lib/mock/demo-performance";
import type { DashboardConfigValue } from "@/lib/dashboard-config";
import type {
  AdAccount,
  Campaign,
  CampaignStatus,
  ResultMetricConfig,
  TimePoint,
} from "@/types/domain";
import type { ClientRecord } from "@/types/client";
import { getDashboardConfig } from "./dashboard-config";
import { resolveRequestedPeriod } from "./period";
import { aggregate, dailyTotals, withinRange, type DailyTotal } from "./mock-helpers";
import type { SeriesPair } from "./portfolio";

export type MetricKey =
  | "investment"
  | "results"
  | "cost_per_result"
  | "reach"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "frequency";

export type MetricFormat = "currency" | "number" | "percent" | "decimal";

export interface DashboardMetric {
  comparison: Comparison;
  format: MetricFormat;
}

export interface DashboardCampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  spend: number;
  results: number;
  costPerResult: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
}

export interface ClientDashboardParams {
  client: ClientRecord;
  preset?: PeriodPreset;
  compare?: boolean;
  accountId?: string;
  campaignId?: string;
}

export interface ClientDashboardData {
  client: ClientRecord;
  config: DashboardConfigValue;
  resultMetric: ResultMetricConfig;
  accounts: AdAccount[];
  campaigns: Campaign[];
  filters: { accountId: string; campaignId: string };
  preset: PeriodPreset;
  compare: boolean;
  range: { start: string; end: string };
  previous: { start: string; end: string };
  metrics: Record<MetricKey, DashboardMetric>;
  /** Séries diárias, keyed por métrica (spend/results/cost_per_result/...). */
  series: Record<string, SeriesPair>;
  campaignRows: DashboardCampaignRow[];
  /** TEMPORÁRIO: toda a performance abaixo é mockada e NÃO vem deste cliente. */
  performanceIsMock: true;
  metaConnected: false;
}

const SERIES_VALUE: Record<string, (t: DailyTotal) => number> = {
  spend: (t) => t.spend,
  results: (t) => t.results,
  cost_per_result: (t) => safeDivide(t.spend, t.results),
  reach: (t) => t.reach,
  impressions: (t) => t.impressions,
  clicks: (t) => t.clicks,
  ctr: (t) => safeDivide(t.clicks, t.impressions) * 100,
  cpc: (t) => safeDivide(t.spend, t.clicks),
  cpm: (t) => safeDivide(t.spend, t.impressions) * 1000,
};

/**
 * Dashboard do cliente.
 * - Identidade e CONFIGURAÇÃO (cards/gráficos/colunas/métrica) são REAIS,
 *   lidas de `public.dashboard_configs` via RLS.
 * - Os VALORES de performance continuam mockados (`getDemoPerformance`), sem
 *   qualquer vínculo com o cliente real. Saem na integração com a Meta Ads.
 */
export async function getClientDashboard(
  params: ClientDashboardParams,
): Promise<ClientDashboardData> {
  const { client, preset, compare = false } = params;
  const accountId =
    params.accountId && params.accountId !== "" ? params.accountId : "all";
  const campaignId =
    params.campaignId && params.campaignId !== "" ? params.campaignId : "all";

  const config = await getDashboardConfig(client.id);
  const resultMetric = config.resultMetric;

  // ---- MOCK: performance demo, não vinculada ao cliente real -------------
  const demo = getDemoPerformance();
  const clientAccounts = demo.accounts;
  const filterCampaigns = demo.campaigns.filter(
    (c) => accountId === "all" || c.accountId === accountId,
  );

  const resolved = resolveRequestedPeriod(preset, compare);
  const { range, previous } = resolved;

  const scoped = demo.dailyMetrics.filter(
    (row) =>
      (accountId === "all" || row.accountId === accountId) &&
      (campaignId === "all" || row.campaignId === campaignId),
  );
  const currentRows = withinRange(scoped, range);
  const previousRows = withinRange(scoped, previous);

  const cur = aggregate(currentRows);
  const prev = aggregate(previousRows);
  const curFreq = safeDivide(cur.impressions, cur.reach);
  const prevFreq = safeDivide(prev.impressions, prev.reach);

  const metric = (
    current: number,
    previousValue: number,
    behavior: MetricBehavior,
    format: MetricFormat,
  ): DashboardMetric => ({
    comparison: compareMetric(current, previousValue, behavior),
    format,
  });

  const metrics: Record<MetricKey, DashboardMetric> = {
    investment: metric(cur.spend, prev.spend, "neutral", "currency"),
    results: metric(cur.results, prev.results, resultMetric.behavior, "number"),
    cost_per_result: metric(cur.cpr, prev.cpr, "lower_is_better", "currency"),
    reach: metric(cur.reach, prev.reach, "higher_is_better", "number"),
    impressions: metric(
      cur.impressions,
      prev.impressions,
      "higher_is_better",
      "number",
    ),
    clicks: metric(cur.clicks, prev.clicks, "higher_is_better", "number"),
    ctr: metric(cur.ctr, prev.ctr, "higher_is_better", "percent"),
    cpc: metric(cur.cpc, prev.cpc, "lower_is_better", "currency"),
    cpm: metric(cur.cpm, prev.cpm, "neutral", "currency"),
    frequency: metric(curFreq, prevFreq, "neutral", "decimal"),
  };

  const currentTotals = dailyTotals(currentRows, eachDay(range));
  const previousTotals = compare
    ? dailyTotals(previousRows, eachDay(previous))
    : null;

  const series: Record<string, SeriesPair> = {};
  for (const [key, valueOf] of Object.entries(SERIES_VALUE)) {
    const current: TimePoint[] = currentTotals.map((t) => ({
      date: t.date,
      value: valueOf(t),
    }));
    series[key] = {
      current,
      previous: previousTotals
        ? previousTotals.map((t) => ({ date: t.date, value: valueOf(t) }))
        : null,
    };
  }

  const campaignRows: DashboardCampaignRow[] = filterCampaigns
    .map((campaign) => {
      const agg = aggregate(
        currentRows.filter((r) => r.campaignId === campaign.id),
      );
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        spend: agg.spend,
        results: agg.results,
        costPerResult: agg.cpr,
        reach: agg.reach,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.ctr,
        cpc: agg.cpc,
        cpm: agg.cpm,
      };
    })
    .sort((a, b) => b.spend - a.spend);
  // ---------------------------------------------------------------------------

  return {
    client,
    config,
    resultMetric,
    accounts: clientAccounts,
    campaigns: filterCampaigns,
    filters: { accountId, campaignId },
    preset: resolved.preset,
    compare,
    range,
    previous,
    metrics,
    series,
    campaignRows,
    performanceIsMock: true,
    metaConnected: false,
  };
}
