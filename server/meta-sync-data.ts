import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";

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
}

export interface MetaValidationOverview {
  hasData: boolean;
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
  totals: MetaValidationTotals;
  counts: { campaigns: number; adsets: number; ads: number };
  campaigns: MetaValidationCampaignRow[];
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

/**
 * Tudo para a tela "Validar sincronização" do cliente — lido do Supabase via
 * RLS, já normalizado. NUNCA chama a Meta. Não toca nos mocks do dashboard.
 */
export const getMetaValidationOverview = cache(
  async (clientId: string): Promise<MetaValidationOverview> => {
    const empty: MetaValidationOverview = {
      hasData: false,
      account: null,
      lastRun: null,
      period: { dateFrom: null, dateTo: null },
      totals: buildTotals(null),
      counts: { campaigns: 0, adsets: 0, ads: 0 },
      campaigns: [],
    };
    if (!UUID_RE.test(clientId)) return empty;

    try {
      const supabase = await createSupabaseServerClient();

      // 1. conta + run + o agregado de conta MAIS RECENTE do preset last_30d
      //    (chave real = intervalo; pegamos o intervalo com date_to mais novo).
      const [acctRes, runRes, accTotRes, campRes, cCnt, sCnt, aCnt] =
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
            .select("spend, impressions, reach, clicks, inline_link_clicks, frequency, date_from, date_to, attribution_window")
            .eq("client_id", clientId)
            .eq("level", "account")
            .eq("period_key", "last_30d")
            .order("date_to", { ascending: false })
            .order("synced_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("meta_campaigns")
            .select("campaign_id, name, status, effective_status")
            .eq("client_id", clientId),
          supabase
            .from("meta_campaigns")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId),
          supabase
            .from("meta_adsets")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId),
          supabase
            .from("meta_ads")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId),
        ]);

      const acct = acctRes.data as Record<string, unknown> | null;
      const run = runRes.data as Record<string, unknown> | null;
      const accTot = accTotRes.data as Record<string, unknown> | null;

      // 2. campanhas do MESMO intervalo do agregado de conta (consistência).
      let campTotData: Record<string, unknown>[] = [];
      if (accTot && typeof accTot.date_from === "string" && typeof accTot.date_to === "string") {
        const campTotRes = await supabase
          .from("meta_insights_periodic")
          .select("entity_id, spend, impressions, reach, clicks, inline_link_clicks, frequency")
          .eq("client_id", clientId)
          .eq("level", "campaign")
          .eq("date_from", accTot.date_from)
          .eq("date_to", accTot.date_to)
          .eq("attribution_window", accTot.attribution_window ?? "7d_click_1d_view");
        campTotData = (campTotRes.data ?? []) as Record<string, unknown>[];
      }

      const campMeta = new Map<string, Record<string, unknown>>(
        ((campRes.data ?? []) as Record<string, unknown>[]).map((r) => [
          String(r.campaign_id),
          r,
        ]),
      );
      const campaigns: MetaValidationCampaignRow[] = campTotData
        .map((r) => {
          const t = totalsFromPeriodicRow(r);
          const meta = campMeta.get(String(r.entity_id));
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
          };
        })
        .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));

      const hasData = Boolean(accTot) || campaigns.length > 0 || Boolean(run);

      return {
        hasData,
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
        totals: buildTotals(accTot),
        counts: {
          campaigns: cCnt.count ?? 0,
          adsets: sCnt.count ?? 0,
          ads: aCnt.count ?? 0,
        },
        campaigns,
      };
    } catch {
      return empty;
    }
  },
);
