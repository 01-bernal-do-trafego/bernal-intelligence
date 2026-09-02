import { eachDay, type PeriodPreset } from "@/lib/date-range";
import { compareMetric, type Comparison } from "@/lib/comparison";
import { safeDivide } from "@/lib/metrics";
import { DEMO_RESULT_METRIC, getDemoPerformance } from "@/lib/mock/demo-performance";
import type {
  AdAccount,
  Campaign,
  CampaignStatus,
  ResultMetricConfig,
  TimePoint,
} from "@/types/domain";
import type { ClientRecord } from "@/types/client";
import { resolveRequestedPeriod } from "./period";
import { aggregate, dailyTotals, withinRange } from "./mock-helpers";
import type { SeriesPair } from "./portfolio";

export interface DashboardKpis {
  spend: Comparison;
  results: Comparison;
  costPerResult: Comparison;
  reach: Comparison;
}

export interface DashboardCampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  spend: number;
  results: number;
  costPerResult: number;
  ctr: number;
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
  /** Identidade REAL do cliente (Supabase). */
  client: ClientRecord;
  resultMetric: ResultMetricConfig;
  accounts: AdAccount[];
  campaigns: Campaign[];
  filters: { accountId: string; campaignId: string };
  preset: PeriodPreset;
  compare: boolean;
  range: { start: string; end: string };
  previous: { start: string; end: string };
  kpis: DashboardKpis;
  series: {
    results: SeriesPair;
    spend: SeriesPair;
    costPerResult: SeriesPair;
  };
  campaignRows: DashboardCampaignRow[];
  /** TEMPORÁRIO: toda a performance abaixo é mockada e NÃO vem deste cliente. */
  performanceIsMock: true;
  metaConnected: false;
}

/**
 * Dashboard do cliente. A identidade vem do registro real; TODA a performance
 * (KPIs, séries, campanhas) vem de `getDemoPerformance()` — perfil demo fixo,
 * sem qualquer vínculo com o cliente real. Sai na integração com a Meta Ads.
 */
export function getClientDashboard(
  params: ClientDashboardParams,
): ClientDashboardData {
  const { client, preset, compare = false } = params;
  const accountId =
    params.accountId && params.accountId !== "" ? params.accountId : "all";
  const campaignId =
    params.campaignId && params.campaignId !== "" ? params.campaignId : "all";

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

  const kpis: DashboardKpis = {
    spend: compareMetric(cur.spend, prev.spend, "neutral"),
    results: compareMetric(cur.results, prev.results, "higher_is_better"),
    costPerResult: compareMetric(cur.cpr, prev.cpr, "lower_is_better"),
    reach: compareMetric(cur.reach, prev.reach, "higher_is_better"),
  };

  const currentTotals = dailyTotals(currentRows, eachDay(range));

  const buildPair = (
    valueOf: (t: (typeof currentTotals)[number]) => number,
  ): SeriesPair => {
    const current: TimePoint[] = currentTotals.map((t) => ({
      date: t.date,
      value: valueOf(t),
    }));
    if (!compare) return { current, previous: null };
    const previousTotals = dailyTotals(previousRows, eachDay(previous));
    return {
      current,
      previous: previousTotals.map((t) => ({ date: t.date, value: valueOf(t) })),
    };
  };

  const series = {
    results: buildPair((t) => t.results),
    spend: buildPair((t) => t.spend),
    costPerResult: buildPair((t) => safeDivide(t.spend, t.results)),
  };

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
        ctr: agg.ctr,
        cpm: agg.cpm,
      };
    })
    .sort((a, b) => b.spend - a.spend);
  // ---------------------------------------------------------------------------

  return {
    client,
    resultMetric: DEMO_RESULT_METRIC,
    accounts: clientAccounts,
    campaigns: filterCampaigns,
    filters: { accountId, campaignId },
    preset: resolved.preset,
    compare,
    range,
    previous,
    kpis,
    series,
    campaignRows,
    performanceIsMock: true,
    metaConnected: false,
  };
}
