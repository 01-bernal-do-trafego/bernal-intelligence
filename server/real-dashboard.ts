import "server-only";

import type { PeriodPreset } from "@/lib/date-range";
import { eachDay } from "@/lib/date-range";
import { compareMetric } from "@/lib/comparison";
import {
  META_DASHBOARD_PRESETS,
  metaPresetRange,
  metaPreviousRange,
  todayInOffset,
} from "@/lib/meta/date-preset";
import {
  coverageByPreset as computeCoverageByPreset,
  dailyHorizon,
  rangeCoverage,
} from "@/lib/meta/daily-coverage";
import { utcOffsetMinutes } from "@/lib/meta/timezone";
import { META_ATTRIBUTION_QUERY_VALUES } from "@/lib/meta/config";
import {
  REACH_MULTI_ACCOUNT_NOTE,
  REACH_NOT_SYNCED_NOTE,
  buildRealTotals,
  reachIsConsolidable,
  realMetricValue,
  sumDailyAdditive,
  type DailyInsightLike,
} from "@/lib/meta/real-metrics";
import { createSupabaseServerClient } from "@/supabase/server";
import type { ClientRecord } from "@/types/client";
import type {
  AdAccount,
  Campaign,
  CampaignObjective,
  CampaignStatus,
} from "@/types/domain";
import type { ClientDataMode } from "./client-data-mode";
import { getDashboardConfig } from "./dashboard-config";
import type {
  ClientDashboardData,
  DashboardCampaignRow,
  DashboardMetric,
  MetricFormat,
  MetricKey,
} from "./client-dashboard";
import type { SeriesPair } from "./portfolio";

// Transição: aceita o identificador novo (`unified_attribution`) e o legado.
// Nunca há os dois para a mesma linha de insight -> sem ambiguidade.
const ATTR_VALUES = META_ATTRIBUTION_QUERY_VALUES;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function mapStatus(effective: string | null, status: string | null): CampaignStatus {
  const s = (effective ?? status ?? "").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s.includes("PAUSED")) return "paused";
  if (["ARCHIVED", "DELETED", "COMPLETED"].some((k) => s.includes(k))) return "ended";
  return "paused";
}
function mapObjective(objective: string | null): CampaignObjective {
  const o = (objective ?? "").toUpperCase();
  if (o.includes("TRAFFIC")) return "traffic";
  if (o.includes("AWARENESS") || o.includes("REACH")) return "reach";
  if (o.includes("LEAD")) return "leads";
  return "conversions";
}

interface MetricSpec {
  key: MetricKey;
  format: MetricFormat;
  behavior: Parameters<typeof compareMetric>[2];
}

const REAL_SPECS: MetricSpec[] = [
  { key: "investment", format: "currency", behavior: "neutral" },
  { key: "impressions", format: "number", behavior: "higher_is_better" },
  { key: "reach", format: "number", behavior: "higher_is_better" },
  { key: "frequency", format: "decimal", behavior: "neutral" },
  { key: "clicks", format: "number", behavior: "higher_is_better" },
  { key: "ctr", format: "percent", behavior: "higher_is_better" },
  { key: "cpc", format: "currency", behavior: "lower_is_better" },
  { key: "cpm", format: "currency", behavior: "neutral" },
];
const CONVERSION_KEYS: MetricKey[] = ["results", "cost_per_result"];
const CONVERSION_REASON = "Métrica de conversão — validação em fase própria.";

function metricEntry(
  current: number | null,
  previous: number | null,
  spec: MetricSpec,
  compare: boolean,
): DashboardMetric {
  return {
    comparison: compareMetric(
      current ?? 0,
      compare ? (previous ?? 0) : (current ?? 0),
      spec.behavior,
    ),
    format: spec.format,
    available: true,
  };
}

interface RealDashboardArgs {
  client: ClientRecord;
  dataMode: ClientDataMode;
  preset: PeriodPreset;
  compare: boolean;
  accountId?: string;
  campaignId?: string;
}

export async function getRealClientDashboard(
  args: RealDashboardArgs,
): Promise<ClientDashboardData> {
  const { client, dataMode, preset, compare } = args;
  const supabase = await createSupabaseServerClient();
  const config = await getDashboardConfig(client.id);

  const linked = dataMode.linkedAccounts;
  const linkedIds = new Set(linked.map((a) => a.adAccountId));
  const accountId =
    args.accountId && linkedIds.has(args.accountId) ? args.accountId : "all";
  const singleAccount =
    accountId !== "all" ? linked.find((a) => a.adAccountId === accountId) : null;

  // "hoje" no fuso da conta (conta única) ou da primeira conta vinculada.
  const tz = (singleAccount ?? linked[0])?.timezoneName ?? "UTC";
  const today = todayInOffset(utcOffsetMinutes(tz) ?? 0);
  const range = metaPresetRange(preset, today);
  const previous = metaPreviousRange(range);
  const horizon = dailyHorizon(today);
  // menor data a buscar: cobre o horizonte E o período anterior (quando existir).
  const dailyFrom = previous.start < horizon.start ? previous.start : horizon.start;
  const dailyTo = range.end > horizon.end ? range.end : horizon.end;

  // ---- campanhas do escopo ------------------------------------------------
  let campQuery = supabase
    .from("meta_campaigns")
    .select("campaign_id, ad_account_id, name, objective, status, effective_status")
    .eq("client_id", client.id);
  if (singleAccount) campQuery = campQuery.eq("ad_account_id", accountId);
  const { data: campData } = await campQuery;
  const campaignsRaw = (campData ?? []) as Record<string, unknown>[];
  const campaigns: Campaign[] = campaignsRaw.map((c) => ({
    id: String(c.campaign_id),
    accountId: String(c.ad_account_id ?? ""),
    clientId: client.id,
    name: str(c.name) ?? String(c.campaign_id),
    status: mapStatus(str(c.effective_status), str(c.status)),
    objective: mapObjective(str(c.objective)),
  }));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const campaignId =
    args.campaignId && campaignById.has(args.campaignId) ? args.campaignId : "all";

  const scope: "all" | "account" | "campaign" =
    campaignId !== "all" ? "campaign" : accountId !== "all" ? "account" : "all";

  // ---- linhas diárias (current + previous numa consulta) -----------------
  const level = scope === "campaign" ? "campaign" : "account";
  let dailyQuery = supabase
    .from("meta_insights_daily")
    .select(
      "date, entity_id, ad_account_id, spend, impressions, clicks, inline_link_clicks, reach, frequency",
    )
    .eq("client_id", client.id)
    .eq("level", level)
    .in("attribution_window", ATTR_VALUES)
    .gte("date", dailyFrom)
    .lte("date", dailyTo);
  if (scope === "campaign") dailyQuery = dailyQuery.eq("entity_id", campaignId);
  else if (scope === "account")
    dailyQuery = dailyQuery.eq("ad_account_id", accountId);
  const { data: dailyData } = await dailyQuery;
  const dailyRows = (dailyData ?? []) as Record<string, unknown>[];

  // datas já sincronizadas no escopo (para calcular cobertura por preset).
  const presentDates = new Set<string>(
    dailyRows.map((r) => String(r.date)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  );
  const coverageAll = computeCoverageByPreset({
    presets: META_DASHBOARD_PRESETS,
    today,
    presentDates,
  });
  const selectedCoverage = rangeCoverage({ range, today, presentDates });

  const toDaily = (r: Record<string, unknown>): DailyInsightLike => ({
    date: String(r.date),
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    inlineLinkClicks: num(r.inline_link_clicks),
    reach: num(r.reach),
    frequency: num(r.frequency),
  });
  const inRange = (d: string, from: string, to: string) => d >= from && d <= to;
  const curDaily = dailyRows
    .filter((r) => inRange(String(r.date), range.start, range.end))
    .map(toDaily);
  const prevDaily = dailyRows
    .filter((r) => inRange(String(r.date), previous.start, previous.end))
    .map(toDaily);

  // soma por dia (várias contas no mesmo dia quando escopo = "all")
  function byDay(rows: DailyInsightLike[]): Map<string, DailyInsightLike> {
    const m = new Map<string, DailyInsightLike>();
    for (const r of rows) {
      const cur = m.get(r.date);
      if (!cur) {
        m.set(r.date, { ...r });
      } else {
        const s = (a: number | null, b: number | null) =>
          a == null && b == null ? null : (a ?? 0) + (b ?? 0);
        m.set(r.date, {
          date: r.date,
          spend: s(cur.spend, r.spend),
          impressions: s(cur.impressions, r.impressions),
          clicks: s(cur.clicks, r.clicks),
          inlineLinkClicks: s(cur.inlineLinkClicks ?? null, r.inlineLinkClicks ?? null),
          // reach/frequency por dia só fazem sentido para 1 entidade; com
          // "all" + N contas não somamos (fica null -> gráfico marca).
          reach: null,
          frequency: null,
        });
      }
    }
    return m;
  }
  const curByDay = byDay(curDaily);
  const prevByDay = byDay(prevDaily);

  const additiveCur = sumDailyAdditive([...curByDay.values()]);
  const additivePrev = sumDailyAdditive([...prevByDay.values()]);

  // ---- reach/frequency do período (só agregado da Meta) -----------------
  const consolidable = reachIsConsolidable({
    scope,
    linkedAccountCount: linked.length,
  });
  const reachEntity =
    scope === "campaign"
      ? campaignId
      : (singleAccount ?? linked[0])?.adAccountId ?? "";

  // O agregado de período da Meta (quando existe) é a fonte AUTORITATIVA dos
  // totais do card — bate com o Ads Manager e não sofre com buraco na série
  // diária. reach/frequency SÓ vêm dele. Sem ele: cai na soma do diário para
  // as aditivas; reach/frequency ficam indisponíveis.
  let periodicRow:
    | {
        spend: number | null;
        impressions: number | null;
        clicks: number | null;
        inlineLinkClicks: number | null;
        reach: number | null;
        frequency: number | null;
        date_from: string;
        date_to: string;
      }
    | null = null;
  // Só usa o agregado quando o escopo é consolidável (1 conta / conta / campanha).
  // Multi-conta "todas": totais das aditivas vêm da soma do diário entre contas.
  if (consolidable && reachEntity) {
    const { data: perData } = await supabase
      .from("meta_insights_periodic")
      .select(
        "spend, impressions, clicks, inline_link_clicks, reach, frequency, date_from, date_to",
      )
      .eq("client_id", client.id)
      .eq("level", level)
      .eq("entity_id", reachEntity)
      .eq("period_key", preset)
      .in("attribution_window", ATTR_VALUES)
      .order("date_to", { ascending: false })
      .limit(1)
      .maybeSingle();
    const p = perData as Record<string, unknown> | null;
    if (p) {
      periodicRow = {
        spend: num(p.spend),
        impressions: num(p.impressions),
        clicks: num(p.clicks),
        inlineLinkClicks: num(p.inline_link_clicks),
        reach: num(p.reach),
        frequency: num(p.frequency),
        date_from: String(p.date_from),
        date_to: String(p.date_to),
      };
    }
  }
  // reach/frequency indisponíveis se: não consolidável (multi-conta) OU sem
  // agregado sincronizado para o intervalo.
  const periodicMissing = consolidable && !periodicRow;

  const additiveSource =
    periodicRow != null
      ? {
          spend: periodicRow.spend ?? additiveCur.spend,
          impressions: periodicRow.impressions ?? additiveCur.impressions,
          clicks: periodicRow.clicks ?? additiveCur.clicks,
          inlineLinkClicks:
            periodicRow.inlineLinkClicks ?? additiveCur.inlineLinkClicks,
        }
      : additiveCur;
  const curTotals = buildRealTotals(
    additiveSource,
    consolidable ? periodicRow : null,
  );
  const prevTotals = buildRealTotals(additivePrev, null);
  /** totais do card vieram do agregado da Meta (autoritativo)? */
  const totalsFromAggregate = periodicRow != null;

  // totais das aditivas vêm de soma de diário incompleto?
  const additiveIncomplete =
    !totalsFromAggregate && selectedCoverage.status !== "complete";
  const INCOMPLETE_NOTE = `Período incompleto no histórico diário — ${selectedCoverage.missingDates.length} dia(s) sem dados. Rode “Sincronizar Meta”.`;

  // ---- métricas ---------------------------------------------------------
  const metrics = {} as Record<MetricKey, DashboardMetric>;
  for (const spec of REAL_SPECS) {
    const cur = realMetricValue(spec.key, curTotals);
    const prev = realMetricValue(spec.key, prevTotals);
    let entry = metricEntry(cur, prev, spec, compare);
    if (spec.key === "reach" || spec.key === "frequency") {
      if (!consolidable) {
        entry = { ...entry, available: false, unavailableReason: REACH_MULTI_ACCOUNT_NOTE };
      } else if (periodicMissing) {
        entry = { ...entry, available: false, unavailableReason: REACH_NOT_SYNCED_NOTE };
      }
    } else {
      if (spec.format !== "currency" && spec.format !== "number" && cur === null) {
        entry = {
          ...entry,
          available: false,
          unavailableReason: "Sem base para calcular no período.",
        };
      } else if (additiveIncomplete) {
        // mostra o valor, mas sinaliza que pode estar incompleto.
        entry = { ...entry, unavailableReason: INCOMPLETE_NOTE };
      }
    }
    metrics[spec.key] = entry;
  }
  for (const key of CONVERSION_KEYS) {
    metrics[key] = {
      comparison: compareMetric(0, 0, "neutral"),
      format: key === "cost_per_result" ? "currency" : "number",
      available: false,
      unavailableReason: CONVERSION_REASON,
    };
  }

  // ---- séries diárias -------------------------------------------------
  const days = eachDay(range);
  const prevDays = compare ? eachDay(previous) : [];
  const dayValue = (
    m: Map<string, DailyInsightLike>,
    d: string,
    metric: string,
  ): number => {
    const row = m.get(d);
    const t = buildRealTotals(
      {
        spend: row?.spend ?? null,
        impressions: row?.impressions ?? null,
        clicks: row?.clicks ?? null,
        inlineLinkClicks: row?.inlineLinkClicks ?? null,
      },
      row ? { reach: row.reach, frequency: row.frequency } : null,
    );
    return realMetricValue(metric, t) ?? 0;
  };
  const SERIES_KEYS = ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "reach", "frequency"];
  const series: Record<string, SeriesPair> = {};
  for (const key of SERIES_KEYS) {
    series[key] = {
      current: days.map((d) => ({ date: d, value: dayValue(curByDay, d, key) })),
      previous: compare
        ? prevDays.map((d) => ({ date: d, value: dayValue(prevByDay, d, key) }))
        : null,
    };
  }
  series.investment = series.spend;

  // ---- tabela de campanhas (agregado de período por campanha) --------
  const [{ data: perCampData }, { data: campDailyData }] = await Promise.all([
    supabase
      .from("meta_insights_periodic")
      .select("entity_id, date_to, spend, impressions, clicks, reach")
      .eq("client_id", client.id)
      .eq("level", "campaign")
      .eq("period_key", preset)
      .in("attribution_window", ATTR_VALUES)
      .order("date_to", { ascending: false }),
    supabase
      .from("meta_insights_daily")
      .select("entity_id, spend, impressions, clicks")
      .eq("client_id", client.id)
      .eq("level", "campaign")
      .in("attribution_window", ATTR_VALUES)
      .gte("date", range.start)
      .lte("date", range.end),
  ]);
  const latestPerCamp = new Map<string, Record<string, unknown>>();
  for (const r of (perCampData ?? []) as Record<string, unknown>[]) {
    const id = String(r.entity_id);
    if (!latestPerCamp.has(id)) latestPerCamp.set(id, r);
  }
  // fallback aditivo (spend/impr/clicks) somando o diário por campanha no
  // intervalo — usado quando o agregado periódico do preset ainda não existe.
  const dailyPerCamp = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const r of (campDailyData ?? []) as Record<string, unknown>[]) {
    const id = String(r.entity_id);
    const cur = dailyPerCamp.get(id) ?? { spend: 0, impressions: 0, clicks: 0 };
    cur.spend += num(r.spend) ?? 0;
    cur.impressions += num(r.impressions) ?? 0;
    cur.clicks += num(r.clicks) ?? 0;
    dailyPerCamp.set(id, cur);
  }
  const campaignRows: DashboardCampaignRow[] = campaigns
    .map((c) => {
      const p = latestPerCamp.get(c.id);
      const fb = dailyPerCamp.get(c.id);
      const t = buildRealTotals(
        {
          spend: p ? num(p.spend) : (fb?.spend ?? null),
          impressions: p ? num(p.impressions) : (fb?.impressions ?? null),
          clicks: p ? num(p.clicks) : (fb?.clicks ?? null),
          inlineLinkClicks: null,
        },
        p ? { reach: num(p.reach), frequency: null } : null,
      );
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        spend: t.spend ?? 0,
        results: 0,
        costPerResult: 0,
        reach: t.reach ?? 0,
        impressions: t.impressions ?? 0,
        clicks: t.clicks ?? 0,
        ctr: realMetricValue("ctr", t) ?? 0,
        cpc: realMetricValue("cpc", t) ?? 0,
        cpm: realMetricValue("cpm", t) ?? 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const accounts: AdAccount[] = linked.map((a) => ({
    id: a.adAccountId,
    clientId: client.id,
    name: a.name ?? a.adAccountId,
    externalId: a.adAccountId,
  }));

  return {
    mode: "real",
    dataStatus: "real",
    client,
    config,
    resultMetric: config.resultMetric,
    accounts,
    campaigns,
    filters: { accountId, campaignId },
    preset,
    compare,
    range,
    previous,
    lastSyncAt: dataMode.lastSyncAt,
    lastSyncStatus: dataMode.lastSyncStatus,
    linkedAccountCount: linked.length,
    reachConsolidable: consolidable,
    reachScopeNote: consolidable ? null : REACH_MULTI_ACCOUNT_NOTE,
    periodicMissing,
    periodicInterval: periodicRow
      ? { from: periodicRow.date_from, to: periodicRow.date_to }
      : null,
    metrics,
    series,
    campaignRows,
    unavailableMetricKeys: [
      ...CONVERSION_KEYS,
      ...(consolidable && !periodicMissing ? [] : (["reach", "frequency"] as MetricKey[])),
    ],
    coverageByPreset: coverageAll,
    selectedCoverage,
    totalsFromAggregate,
  };
}
