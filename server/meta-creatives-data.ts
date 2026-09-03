import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import { parsePeriod, type PeriodPreset } from "@/lib/date-range";
import { metaPresetRange, todayInOffset } from "@/lib/meta/date-preset";
import { utcOffsetMinutes } from "@/lib/meta/timezone";
import { META_ATTRIBUTION_QUERY_VALUES } from "@/lib/meta/config";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import { assetVariantSummary, type CreativeFormat } from "@/lib/meta/creative-normalize";
import {
  buildCreativePerformance,
  type AdCreativeObservation,
  type AdDailyInsight,
  type AdForCreative,
  type CreativePerfRow,
} from "@/lib/meta/creative-performance";
import { RELEASED_CONVERSION_METRICS } from "@/lib/meta/dashboard-conversions";
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
const day = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
};
function asNumberMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export interface CreativeValidationRow extends CreativePerfRow {
  name: string | null;
  objectType: string | null;
  format: CreativeFormat;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  imageHash: string | null;
  videoId: string | null;
  title: string | null;
  body: string | null;
  description: string | null;
  callToActionType: string | null;
  hasImage: boolean;
  hasVideo: boolean;
  isDynamic: boolean;
  variantSummary: string | null;
  adNames: string[];
  campaignNames: string[];
  adsetNames: string[];
}

export interface CreativeValidationOverview {
  hasData: boolean;
  preset: PeriodPreset;
  account: {
    adAccountId: string;
    name: string | null;
    currency: string | null;
  } | null;
  period: { start: string; end: string };
  /** algum insight nível ad no intervalo? */
  periodSynced: boolean;
  resultMetric: { type: ResultMetricType; label: string; costLabel: string };
  counts: {
    creativesFound: number;
    withImage: number;
    withVideo: number;
    dynamic: number;
    withPeriodPerformance: number;
    attributionComplete: number;
    attributionPartial: number;
    attributionUnconfirmed: number;
  };
  rows: CreativeValidationRow[];
  filters: { accountId: string; campaignId: string };
  accounts: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
}

function emptyOverview(preset: PeriodPreset): CreativeValidationOverview {
  return {
    hasData: false,
    preset,
    account: null,
    period: { start: "", end: "" },
    periodSynced: false,
    resultMetric: { type: "results", label: "Resultados", costLabel: "Custo por resultado" },
    counts: {
      creativesFound: 0,
      withImage: 0,
      withVideo: 0,
      dynamic: 0,
      withPeriodPerformance: 0,
      attributionComplete: 0,
      attributionPartial: 0,
      attributionUnconfirmed: 0,
    },
    rows: [],
    filters: { accountId: "all", campaignId: "all" },
    accounts: [],
    campaigns: [],
  };
}

/**
 * Área administrativa `/clients/[id]/creatives`. Lido do Supabase via RLS.
 * NUNCA chama a Meta. Não toca no dashboard principal.
 *
 * Performance por creative = Σ insights nível AD dos ads que o usam, restrita
 * aos DIAS observacionalmente seguros (ver `lib/meta/creative-attribution.ts`).
 */
export const getCreativeValidationOverview = cache(
  async (
    clientId: string,
    opts: { preset?: string; accountId?: string; campaignId?: string } = {},
  ): Promise<CreativeValidationOverview> => {
    const preset = parsePeriod(opts.preset);
    if (!UUID_RE.test(clientId)) return emptyOverview(preset);

    try {
      const supabase = await createSupabaseServerClient();

      const [acctRes, dcfgRes, campNameRes, adsetNameRes] = await Promise.all([
        supabase
          .from("meta_ad_accounts")
          .select("ad_account_id, account_name, currency, timezone_name")
          .eq("client_id", clientId)
          .eq("is_linked", true)
          .order("last_sync_at", { ascending: false }),
        supabase
          .from("dashboard_configs")
          .select("result_metric")
          .eq("client_id", clientId)
          .maybeSingle(),
        supabase.from("meta_campaigns").select("campaign_id, name").eq("client_id", clientId),
        supabase.from("meta_adsets").select("adset_id, name").eq("client_id", clientId),
      ]);

      const linked = (acctRes.data ?? []) as Record<string, unknown>[];
      if (linked.length === 0) return emptyOverview(preset);

      const accountId =
        opts.accountId &&
        linked.some((a) => String(a.ad_account_id) === opts.accountId)
          ? opts.accountId
          : "all";
      const scopedAccount =
        accountId !== "all"
          ? linked.find((a) => String(a.ad_account_id) === accountId)
          : linked[0];

      const tz = str(scopedAccount?.timezone_name) ?? "UTC";
      const today = todayInOffset(utcOffsetMinutes(tz) ?? 0);
      const range = metaPresetRange(preset, today);

      const rmRaw = (dcfgRes.data as { result_metric?: unknown } | null)?.result_metric;
      const resultType: ResultMetricType =
        rmRaw &&
        typeof rmRaw === "object" &&
        typeof (rmRaw as Record<string, unknown>).type === "string" &&
        (rmRaw as Record<string, unknown>).type !== "custom"
          ? ((rmRaw as Record<string, unknown>).type as ResultMetricType)
          : "results";
      const rmPreset = RESULT_METRIC_PRESETS[resultType] ?? RESULT_METRIC_PRESETS.results;

      // ---- ads do escopo -------------------------------------------------
      let adQuery = supabase
        .from("meta_ads")
        .select("ad_id, creative_id, updated_time, campaign_id, adset_id, name")
        .eq("client_id", clientId);
      if (accountId !== "all") adQuery = adQuery.eq("ad_account_id", accountId);
      const { data: adData } = await adQuery;
      let adRows = (adData ?? []) as Record<string, unknown>[];

      const campaignId =
        opts.campaignId &&
        adRows.some((a) => String(a.campaign_id) === opts.campaignId)
          ? opts.campaignId
          : "all";
      if (campaignId !== "all") {
        adRows = adRows.filter((a) => String(a.campaign_id) === campaignId);
      }
      const scopedAdIds = new Set(adRows.map((a) => String(a.ad_id)));

      const ads: AdForCreative[] = adRows.map((a) => ({
        adId: String(a.ad_id),
        currentCreativeId: str(a.creative_id),
        updatedDate: day(a.updated_time),
        campaignId: str(a.campaign_id),
        adsetId: str(a.adset_id),
        name: str(a.name),
      }));

      // ---- relação ad↔creative (log de observação) ---------------------
      const { data: relData } = await supabase
        .from("meta_ad_creatives")
        .select("ad_id, creative_id, first_seen, last_seen")
        .eq("client_id", clientId);
      const observations: AdCreativeObservation[] = ((relData ?? []) as Record<
        string,
        unknown
      >[])
        .filter((r) => scopedAdIds.has(String(r.ad_id)))
        .map((r) => ({
          adId: String(r.ad_id),
          creativeId: String(r.creative_id),
          firstSeen: day(r.first_seen) ?? range.start,
          lastSeen: day(r.last_seen) ?? range.start,
        }));

      // ---- creatives (detalhe normalizado, já sincronizado) -----------
      const { data: creativeData } = await supabase
        .from("meta_creatives")
        .select(
          "creative_id, name, object_type, format, thumbnail_url, image_url, image_hash, video_id, title, body, description, call_to_action_type, asset_feed_spec",
        )
        .eq("client_id", clientId);
      const creativeById = new Map(
        ((creativeData ?? []) as Record<string, unknown>[]).map((c) => [
          String(c.creative_id),
          c,
        ]),
      );

      // ---- insights nível ad no intervalo ----------------------------
      let insQuery = supabase
        .from("meta_insights_daily")
        .select(
          "entity_id, date, spend, impressions, clicks, raw_actions, raw_action_values",
        )
        .eq("client_id", clientId)
        .eq("level", "ad")
        .in("attribution_window", META_ATTRIBUTION_QUERY_VALUES)
        .gte("date", range.start)
        .lte("date", range.end);
      if (accountId !== "all") insQuery = insQuery.eq("ad_account_id", accountId);
      const { data: insData } = await insQuery;
      const dailyInsights: AdDailyInsight[] = ((insData ?? []) as Record<
        string,
        unknown
      >[])
        .filter((r) => scopedAdIds.has(String(r.entity_id)))
        .map((r) => ({
          adId: String(r.entity_id),
          date: String(r.date),
          spend: num(r.spend),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          rawActions: asNumberMap(r.raw_actions),
          rawActionValues: asNumberMap(r.raw_action_values),
        }));
      const periodSynced = dailyInsights.length > 0;

      // ---- performance por creative (atribuição por dia) -------------
      const perf = buildCreativePerformance({
        period: range,
        today,
        resultType,
        ads,
        observations,
        dailyInsights,
      });

      const campNameById = new Map(
        ((campNameRes.data ?? []) as Record<string, unknown>[]).map((c) => [
          String(c.campaign_id),
          str(c.name),
        ]),
      );
      const adsetNameById = new Map(
        ((adsetNameRes.data ?? []) as Record<string, unknown>[]).map((s) => [
          String(s.adset_id),
          str(s.name),
        ]),
      );
      const adNameById = new Map(ads.map((a) => [a.adId, a.name]));

      const rows: CreativeValidationRow[] = perf
        .map((p) => {
          const c = creativeById.get(p.creativeId);
          const format = (str(c?.format) as CreativeFormat) ?? "unknown";
          const imageHash = str(c?.image_hash);
          const imageUrl = str(c?.image_url);
          const videoId = str(c?.video_id);
          const hasImage =
            format === "image" ||
            format === "carousel" ||
            Boolean(imageHash) ||
            Boolean(imageUrl);
          const hasVideo = format === "video" || Boolean(videoId);
          return {
            ...p,
            name: str(c?.name),
            objectType: str(c?.object_type),
            format,
            thumbnailUrl: str(c?.thumbnail_url),
            imageUrl,
            imageHash,
            videoId,
            title: str(c?.title),
            body: str(c?.body),
            description: str(c?.description),
            callToActionType: str(c?.call_to_action_type),
            hasImage,
            hasVideo,
            isDynamic: format === "dynamic",
            variantSummary: assetVariantSummary({
              images: 0,
              videos: 0,
              bodies: 0,
              titles: 0,
              descriptions: 0,
              callToActions: 0,
              formats: 0,
              ...deriveCounts(c?.asset_feed_spec),
            }),
            adNames: p.adIds.map((id) => adNameById.get(id) ?? id),
            campaignNames: p.campaignIds
              .map((id) => campNameById.get(id) ?? id)
              .filter((x): x is string => Boolean(x)),
            adsetNames: p.adsetIds
              .map((id) => adsetNameById.get(id) ?? id)
              .filter((x): x is string => Boolean(x)),
          };
        })
        .sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0));

      const counts = {
        creativesFound: rows.length,
        withImage: rows.filter((r) => r.hasImage).length,
        withVideo: rows.filter((r) => r.hasVideo).length,
        dynamic: rows.filter((r) => r.isDynamic).length,
        withPeriodPerformance: rows.filter((r) => r.hasPeriodPerformance).length,
        attributionComplete: rows.filter((r) => r.attribution === "complete").length,
        attributionPartial: rows.filter((r) => r.attribution === "partial").length,
        attributionUnconfirmed: rows.filter((r) => r.attribution === "unconfirmed")
          .length,
      };

      return {
        hasData: rows.length > 0 || adRows.length > 0,
        preset,
        account: {
          adAccountId: String(scopedAccount?.ad_account_id ?? ""),
          name: str(scopedAccount?.account_name),
          currency: str(scopedAccount?.currency),
        },
        period: range,
        periodSynced,
        resultMetric: {
          type: resultType,
          label: rmPreset.resultLabel,
          costLabel: rmPreset.costLabel,
        },
        counts,
        rows,
        filters: { accountId, campaignId },
        accounts: linked.map((a) => ({
          id: String(a.ad_account_id),
          name: str(a.account_name) ?? String(a.ad_account_id),
        })),
        campaigns: [
          ...new Map(
            adRows
              .map((a) => String(a.campaign_id))
              .filter((id) => id && id !== "null")
              .map((id) => [id, campNameById.get(id) ?? id]),
          ),
        ].map(([id, name]) => ({ id, name: name ?? id })),
      };
    } catch {
      return emptyOverview(preset);
    }
  },
);

/** contagens de variantes a partir de `asset_feed_spec` (jsonb). */
function deriveCounts(afs: unknown): Partial<{
  images: number;
  videos: number;
  bodies: number;
  titles: number;
  descriptions: number;
}> {
  const r =
    afs && typeof afs === "object" && !Array.isArray(afs)
      ? (afs as Record<string, unknown>)
      : null;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    images: len(r?.images),
    videos: len(r?.videos),
    bodies: len(r?.bodies),
    titles: len(r?.titles),
    descriptions: len(r?.descriptions),
  };
}

export { RELEASED_CONVERSION_METRICS };
