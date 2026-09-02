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
import type { Coverage } from "@/lib/meta/daily-coverage";
import { getDashboardConfig } from "./dashboard-config";
import { getClientDataMode, type DashboardDataStatus } from "./client-data-mode";
import { getRealClientDashboard } from "./real-dashboard";
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
  | "frequency"
  // Mensageria liberada (validada com dados reais). O conjunto canônico das
  // 6 métricas de conversão liberadas vive em `lib/meta/dashboard-conversions`
  // (`RELEASED_CONVERSION_METRICS`).
  | "messaging_conversations_started"
  | "cost_per_conversation"
  | "messaging_contacts_total"
  | "messaging_contacts_new";

export type MetricFormat = "currency" | "number" | "percent" | "decimal";

export interface DashboardMetric {
  comparison: Comparison;
  format: MetricFormat;
  /** `false` quando a métrica não tem fonte REAL nesta fase (ex.: conversões,
   *  ou reach/frequency sem agregado sincronizado / entre múltiplas contas). */
  available: boolean;
  unavailableReason?: string;
}

export interface DashboardCampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  /**
   * Métricas de conversão por campanha (id -> valor). `null` = campanha sem
   * esse evento no período (mostra "—"); `0` = evento medido com zero.
   * Chaves: results, cost_per_result, messaging_conversations_started,
   * cost_per_conversation, messaging_contacts_total, messaging_contacts_new.
   */
  conversions: Record<string, number | null>;
}

export interface ClientDashboardParams {
  client: ClientRecord;
  preset?: PeriodPreset;
  compare?: boolean;
  accountId?: string;
  campaignId?: string;
}

export interface ClientDashboardData {
  /** "real" = dados sincronizados da Meta; "demo" = mock (só dev). */
  mode: "real" | "demo";
  dataStatus: DashboardDataStatus;
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
  /** Séries diárias, keyed por métrica (spend/impressions/clicks/...). */
  series: Record<string, SeriesPair>;
  campaignRows: DashboardCampaignRow[];

  /** Só no modo real: */
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  linkedAccountCount?: number;
  /** reach/frequency podem ser mostrados neste escopo? */
  reachConsolidable?: boolean;
  /** nota quando reach/frequency não podem ser consolidados (múltiplas contas). */
  reachScopeNote?: string | null;
  /** o agregado de período (reach/frequency) deste intervalo ainda não existe. */
  periodicMissing?: boolean;
  /** intervalo real do agregado de reach usado (pode diferir levemente da faixa diária). */
  periodicInterval?: { from: string; to: string } | null;
  /** chaves de métrica sem dado real nesta fase (para cards/colunas). */
  unavailableMetricKeys?: MetricKey[];
  /** cobertura da série diária por preset (todas as datas exigidas existem?). */
  coverageByPreset?: Record<string, Coverage>;
  /** cobertura do período selecionado. */
  selectedCoverage?: Coverage;
  /** totais do card vieram do agregado autoritativo da Meta (vs soma do diário)? */
  totalsFromAggregate?: boolean;
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
  frequency: (t) => safeDivide(t.impressions, t.reach),
  // demo (dev sem Supabase): reaproveita `results` do mock para a série de
  // conversas iniciadas; contatos não têm mock -> ficam em 0.
  messaging_conversations_started: (t) => t.results,
  cost_per_conversation: (t) => safeDivide(t.spend, t.results),
  messaging_contacts_total: () => 0,
  messaging_contacts_new: () => 0,
};

/**
 * Dashboard do cliente.
 * - Identidade e CONFIGURAÇÃO (cards/gráficos/colunas/métrica) são REAIS,
 *   lidas de `public.dashboard_configs` via RLS.
 * - PERFORMANCE:
 *     modo `real`  -> dados sincronizados da Meta (`getRealClientDashboard`);
 *     modo `demo`  -> mock (`getDemoPerformance`), SOMENTE em desenvolvimento
 *                     sem Supabase. Nunca misturado com dados reais.
 *   Cliente conectado mas sem sync, ou sem Meta: a página mostra o estado
 *   correspondente (`awaiting_sync` / `no_meta`) e NÃO usa o mock.
 */
export async function getClientDashboard(
  params: ClientDashboardParams,
): Promise<ClientDashboardData> {
  const { client, preset, compare = false } = params;

  const dataMode = await getClientDataMode(client.id);
  if (dataMode.dataStatus === "real") {
    return getRealClientDashboard({
      client,
      dataMode,
      preset: preset ?? "last_7d",
      compare,
      accountId: params.accountId,
      campaignId: params.campaignId,
    });
  }
  if (dataMode.mode === "real") {
    // conectado sem sync (`awaiting_sync`) ou sem Meta (`no_meta`):
    // devolve um esqueleto SEM números (a página renderiza o estado certo).
    return emptyDashboard(client, dataMode.dataStatus, preset, compare);
  }

  // ---- modo demo (dev sem Supabase) ------------------------------------
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
    available: true,
  });

  const demoUnavailable = (format: MetricFormat): DashboardMetric => ({
    comparison: compareMetric(0, 0, "neutral"),
    format,
    available: false,
    unavailableReason: "Sem dados demonstrativos para esta métrica.",
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
    // demo: conversas iniciadas reaproveita o mock de `results`; contatos não.
    messaging_conversations_started: metric(
      cur.results,
      prev.results,
      "higher_is_better",
      "number",
    ),
    cost_per_conversation: metric(cur.cpr, prev.cpr, "lower_is_better", "currency"),
    messaging_contacts_total: demoUnavailable("number"),
    messaging_contacts_new: demoUnavailable("number"),
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
        reach: agg.reach,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.ctr,
        cpc: agg.cpc,
        cpm: agg.cpm,
        conversions: {
          results: agg.results,
          cost_per_result: agg.cpr,
          messaging_conversations_started: agg.results,
          cost_per_conversation: agg.cpr,
          messaging_contacts_total: null,
          messaging_contacts_new: null,
        },
      };
    })
    .sort((a, b) => b.spend - a.spend);
  // ---------------------------------------------------------------------------

  return {
    mode: "demo",
    dataStatus: "demo",
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
  };
}

/**
 * Esqueleto sem números para clientes em modo real mas ainda sem dados
 * (conectado sem sync, ou sem Meta). A página usa `dataStatus` para mostrar
 * o estado correto — nunca cai no mock.
 */
async function emptyDashboard(
  client: ClientRecord,
  dataStatus: DashboardDataStatus,
  preset: PeriodPreset | undefined,
  compare: boolean,
): Promise<ClientDashboardData> {
  const config = await getDashboardConfig(client.id);
  const zero = (format: MetricFormat): DashboardMetric => ({
    comparison: compareMetric(0, 0, "neutral"),
    format,
    available: false,
    unavailableReason:
      dataStatus === "no_meta"
        ? "Conecte a Meta Ads deste cliente."
        : "Rode a primeira sincronização.",
  });
  const metrics = {
    investment: zero("currency"),
    results: zero("number"),
    cost_per_result: zero("currency"),
    reach: zero("number"),
    impressions: zero("number"),
    clicks: zero("number"),
    ctr: zero("percent"),
    cpc: zero("currency"),
    cpm: zero("currency"),
    frequency: zero("decimal"),
    messaging_conversations_started: zero("number"),
    cost_per_conversation: zero("currency"),
    messaging_contacts_total: zero("number"),
    messaging_contacts_new: zero("number"),
  } as Record<MetricKey, DashboardMetric>;

  return {
    mode: "real",
    dataStatus,
    client,
    config,
    resultMetric: config.resultMetric,
    accounts: [],
    campaigns: [],
    filters: { accountId: "all", campaignId: "all" },
    preset: preset ?? "last_7d",
    compare,
    range: { start: "", end: "" },
    previous: { start: "", end: "" },
    metrics,
    series: {},
    campaignRows: [],
    linkedAccountCount: 0,
    unavailableMetricKeys: Object.keys(metrics) as MetricKey[],
  };
}
