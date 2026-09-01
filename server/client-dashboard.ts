import { eachDay, type PeriodPreset } from "@/lib/date-range";
import { compareMetric, type Comparison } from "@/lib/comparison";
import { safeDivide } from "@/lib/metrics";
import { getMockDataset } from "@/lib/mock/dataset";
import type {
  AdAccount,
  Campaign,
  CampaignStatus,
  Client,
  ResultMetricConfig,
  TimePoint,
} from "@/types/domain";
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
  clientId: string;
  preset?: PeriodPreset;
  compare?: boolean;
  accountId?: string;
  campaignId?: string;
}

export interface ClientDashboardData {
  client: Client;
  /** Métrica principal configurada para este cliente (rótulos dinâmicos). */
  resultMetric: ResultMetricConfig;
  accounts: AdAccount[];
  /** Campanhas disponíveis para o filtro (respeita o filtro de conta). */
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
  syncedLabel: string;
}

export function getClientDashboard(
  params: ClientDashboardParams,
): ClientDashboardData | null {
  const { clientId, preset, compare = false } = params;
  const accountId = params.accountId && params.accountId !== "" ? params.accountId : "all";
  const campaignId =
    params.campaignId && params.campaignId !== "" ? params.campaignId : "all";

  const { clients, accounts, campaigns, dailyMetrics } = getMockDataset();
  const client = clients.find((c) => c.id === clientId);
  if (!client) return null;

  const clientAccounts = accounts.filter((a) => a.clientId === clientId);

  const filterCampaigns = campaigns.filter(
    (c) =>
      c.clientId === clientId &&
      (accountId === "all" || c.accountId === accountId),
  );

  const resolved = resolveRequestedPeriod(preset, compare);
  const { range, previous } = resolved;

  const matches = (row: (typeof dailyMetrics)[number]) =>
    row.clientId === clientId &&
    (accountId === "all" || row.accountId === accountId) &&
    (campaignId === "all" || row.campaignId === campaignId);

  const scoped = dailyMetrics.filter(matches);
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

  const currentDays = eachDay(range);
  const currentTotals = dailyTotals(currentRows, currentDays);

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

  return {
    client,
    resultMetric: client.dashboardConfig.resultMetric,
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
    syncedLabel: "Sincronizado há poucos minutos",
  };
}
