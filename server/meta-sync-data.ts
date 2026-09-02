import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import {
  buildConversionRows,
  conversionTotalsFromRow,
  describeEvents,
  resultMetricSource,
  type ConversionMetricRow,
  type EventRow,
} from "@/lib/meta/conversion-events";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import {
  META_ATTRIBUTION_LEGACY_WINDOW,
  META_ATTRIBUTION_QUERY_VALUES,
} from "@/lib/meta/config";
import { parsePeriod, type PeriodPreset } from "@/lib/date-range";
import type { ResultMetricType } from "@/types/domain";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function totalsFromPeriodicRow(row: Record<string, unknown> | null): MetricTotals {
  return {
    spend: num(row?.spend),
    impressions: num(row?.impressions),
    reach: num(row?.reach),
    clicks: num(row?.clicks),
    inline_link_clicks: num(row?.inline_link_clicks),
    frequency: num(row?.frequency),
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
  };
}

export interface MetaValidationTotals {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** frequência calculada (impressões/alcance) — para conferir com a da Meta. */
  frequencyComputed: number | null;
}

export interface MetaValidationCampaignRow {
  campaignId: string;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** conversões: id de métrica -> valor (null = sem fonte real). */
  conversions: Record<string, number | null>;
}

export interface MetaResultMetricInfo {
  type: ResultMetricType;
  label: string;
  costLabel: string;
  value: number | null;
  costPerResult: number | null;
  source: string | null;
  /** o evento configurado não veio na resposta -> métrica indisponível. */
  available: boolean;
}

export interface MetaValidationOverview {
  hasData: boolean;
  preset: PeriodPreset;
  account: {
    adAccountId: string;
    name: string | null;
    currency: string | null;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
  } | null;
  lastRun: {
    status: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    stats: Record<string, unknown> | null;
    errorText: string | null;
  } | null;
  period: { dateFrom: string | null; dateTo: string | null };
  attributionWindow: string | null;
  totals: MetaValidationTotals;
  counts: { campaigns: number; adsets: number; ads: number };
  campaigns: MetaValidationCampaignRow[];
  /** CONVERSÕES V1 — validação (não vai para o dashboard principal ainda). */
  events: EventRow[];
  conversionRows: ConversionMetricRow[];
  resultMetric: MetaResultMetricInfo | null;
  /** ids de conversão com pelo menos um valor real em alguma campanha. */
  relevantConversionColumns: string[];
}

function buildTotals(row: Record<string, unknown> | null): MetaValidationTotals {
  const t = totalsFromPeriodicRow(row);
  return {
    spend: t.spend,
    impressions: t.impressions,
    reach: t.reach,
    frequency: t.frequency,
    clicks: t.clicks,
    ctr: computeMetric("ctr", t),
    cpc: computeMetric("cpc", t),
    cpm: computeMetric("cpm", t),
    frequencyComputed: computeMetric("frequency", t),
  };
}

const CONV_ORDER = [
  "results",
  "cost_per_result",
  "leads",
  "cpl",
  "conversations",
  "cost_per_conversation",
  "purchases",
  "cpa",
  "revenue",
  "roas",
];

/**
 * Tudo para a área administrativa `/clients/[id]/meta-data` do cliente — lido
 * do Supabase via RLS, já normalizado. NUNCA chama a Meta. Não toca no
 * dashboard principal.
 */
export const getMetaValidationOverview = cache(
  async (
    clientId: string,
    presetInput?: string,
  ): Promise<MetaValidationOverview> => {
    const preset: PeriodPreset = parsePeriod(presetInput ?? "last_30d");
    const empty: MetaValidationOverview = {
      hasData: false,
      preset,
      account: null,
      lastRun: null,
      period: { dateFrom: null, dateTo: null },
      attributionWindow: null,
      totals: buildTotals(null),
      counts: { campaigns: 0, adsets: 0, ads: 0 },
      campaigns: [],
      events: [],
      conversionRows: [],
      resultMetric: null,
      relevantConversionColumns: [],
    };
    if (!UUID_RE.test(clientId)) return empty;

    try {
      const supabase = await createSupabaseServerClient();

      const [acctRes, runRes, accTotRes, campRes, dcfgRes, cCnt, sCnt, aCnt] =
        await Promise.all([
          supabase
            .from("meta_ad_accounts")
            .select("ad_account_id, account_name, currency, last_sync_at, last_sync_status")
            .eq("client_id", clientId)
            .eq("is_linked", true)
            .order("last_sync_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("meta_sync_runs")
            .select("status, started_at, finished_at, date_from, date_to, stats, error_text")
            .eq("client_id", clientId)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("meta_insights_periodic")
            .select(
              "spend, impressions, reach, clicks, inline_link_clicks, frequency, actions, action_values, raw_actions, raw_action_values, date_from, date_to, attribution_window",
            )
            .eq("client_id", clientId)
            .eq("level", "account")
            .eq("period_key", preset)
            .in("attribution_window", META_ATTRIBUTION_QUERY_VALUES)
            .order("date_to", { ascending: false })
            .order("synced_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("meta_campaigns")
            .select("campaign_id, name, status, effective_status")
            .eq("client_id", clientId),
          supabase
            .from("dashboard_configs")
            .select("result_metric")
            .eq("client_id", clientId)
            .maybeSingle(),
          supabase.from("meta_campaigns").select("id", { count: "exact", head: true }).eq("client_id", clientId),
          supabase.from("meta_adsets").select("id", { count: "exact", head: true }).eq("client_id", clientId),
          supabase.from("meta_ads").select("id", { count: "exact", head: true }).eq("client_id", clientId),
        ]);

      const acct = acctRes.data as Record<string, unknown> | null;
      const run = runRes.data as Record<string, unknown> | null;
      const accTot = accTotRes.data as Record<string, unknown> | null;

      const rmRaw = (dcfgRes.data as { result_metric?: unknown } | null)?.result_metric;
      const resultType: ResultMetricType =
        rmRaw && typeof rmRaw === "object" &&
        typeof (rmRaw as Record<string, unknown>).type === "string" &&
        (rmRaw as Record<string, unknown>).type !== "custom"
          ? ((rmRaw as Record<string, unknown>).type as ResultMetricType)
          : "results";

      // campanhas do MESMO intervalo do agregado de conta (consistência).
      let campTotData: Record<string, unknown>[] = [];
      if (accTot && typeof accTot.date_from === "string" && typeof accTot.date_to === "string") {
        const campTotRes = await supabase
          .from("meta_insights_periodic")
          .select(
            "entity_id, spend, impressions, reach, clicks, inline_link_clicks, frequency, actions, action_values",
          )
          .eq("client_id", clientId)
          .eq("level", "campaign")
          .eq("date_from", accTot.date_from)
          .eq("date_to", accTot.date_to)
          .eq(
            "attribution_window",
            (typeof accTot.attribution_window === "string" &&
              accTot.attribution_window) ||
              META_ATTRIBUTION_LEGACY_WINDOW,
          );
        campTotData = (campTotRes.data ?? []) as Record<string, unknown>[];
      }

      const campMeta = new Map<string, Record<string, unknown>>(
        ((campRes.data ?? []) as Record<string, unknown>[]).map((r) => [
          String(r.campaign_id),
          r,
        ]),
      );

      const relevant = new Set<string>();
      const campaigns: MetaValidationCampaignRow[] = campTotData
        .map((r) => {
          const t = totalsFromPeriodicRow(r);
          const convT = conversionTotalsFromRow(r);
          const meta = campMeta.get(String(r.entity_id));
          const conversions: Record<string, number | null> = {};
          for (const id of CONV_ORDER) {
            const v = computeMetric(id, convT);
            conversions[id] = v;
            if (v !== null) relevant.add(id);
          }
          return {
            campaignId: String(r.entity_id),
            name: str(meta?.name),
            status: str(meta?.status),
            effectiveStatus: str(meta?.effective_status),
            spend: t.spend,
            impressions: t.impressions,
            reach: t.reach,
            clicks: t.clicks,
            ctr: computeMetric("ctr", t),
            cpc: computeMetric("cpc", t),
            cpm: computeMetric("cpm", t),
            conversions,
          };
        })
        .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));

      // conversões no nível da CONTA (fonte autoritativa do período).
      const events = accTot
        ? describeEvents(accTot.raw_actions, accTot.raw_action_values)
        : [];
      const convTotals = accTot ? conversionTotalsFromRow(accTot) : null;
      const conversionRows = convTotals
        ? buildConversionRows({
            totals: convTotals,
            rawActions: accTot?.raw_actions,
            rawActionValues: accTot?.raw_action_values,
            resultType,
          })
        : [];

      const rmPreset = RESULT_METRIC_PRESETS[resultType];
      const resultValue = convTotals ? computeMetric("results", convTotals) : null;
      const resultMetric: MetaResultMetricInfo | null = accTot
        ? {
            type: resultType,
            label: rmPreset?.resultLabel ?? "Resultados",
            costLabel: rmPreset?.costLabel ?? "Custo por resultado",
            value: resultValue,
            costPerResult: convTotals
              ? computeMetric("cost_per_result", convTotals)
              : null,
            source: resultMetricSource(resultType, accTot?.raw_actions),
            available: resultValue !== null,
          }
        : null;

      const hasData = Boolean(accTot) || campaigns.length > 0 || Boolean(run);

      return {
        hasData,
        preset,
        account: acct
          ? {
              adAccountId: String(acct.ad_account_id ?? ""),
              name: str(acct.account_name),
              currency: str(acct.currency),
              lastSyncAt: str(acct.last_sync_at),
              lastSyncStatus: str(acct.last_sync_status),
            }
          : null,
        lastRun: run
          ? {
              status: str(run.status),
              startedAt: str(run.started_at),
              finishedAt: str(run.finished_at),
              dateFrom: str(run.date_from),
              dateTo: str(run.date_to),
              stats:
                run.stats && typeof run.stats === "object"
                  ? (run.stats as Record<string, unknown>)
                  : null,
              errorText: str(run.error_text),
            }
          : null,
        period: {
          dateFrom: str(accTot?.date_from) ?? str(run?.date_from),
          dateTo: str(accTot?.date_to) ?? str(run?.date_to),
        },
        attributionWindow: str(accTot?.attribution_window),
        totals: buildTotals(accTot),
        counts: {
          campaigns: cCnt.count ?? 0,
          adsets: sCnt.count ?? 0,
          ads: aCnt.count ?? 0,
        },
        campaigns,
        events,
        conversionRows,
        resultMetric,
        relevantConversionColumns: CONV_ORDER.filter((id) => relevant.has(id)),
      };
    } catch {
      return empty;
    }
  },
);
