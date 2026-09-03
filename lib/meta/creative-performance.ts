/**
 * Performance por CREATIVE derivada de insights nível AD. Módulo PURO.
 *
 * A Meta não tem `insight_level="creative"` nesta arquitetura:
 *   performance do creative = Σ insights dos ADS que o usam,
 *   restrita aos DIAS em que a relação ad↔creative é observacionalmente segura
 *   (ver `creative-attribution.ts`).
 *
 * Aditivas (spend/impressions/clicks/eventos crus) => soma dos dias atribuíveis.
 * CTR/CPC/CPM/custo-por-resultado => recalculados sobre os TOTAIS (nunca média
 * por ad). reach/frequency => NUNCA agregados (mesma pessoa pode ver 2 ads com
 * o mesmo creative). `results`/`cost_per_result` => config-driven em leitura.
 * `null` (sem evento/gasto) ≠ `0` (medido).
 */

import type { MetricTotals } from "@/lib/metrics/compute";
import { computeMetric } from "@/lib/metrics/compute";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import {
  RELEASED_CONVERSION_METRICS,
  conversionMetricValue,
  sumRawMaps,
} from "@/lib/meta/dashboard-conversions";
import {
  attributeAdToCreative,
  type AttributionStatus,
  type ExclusionReason,
  type ObservedRelation,
} from "@/lib/meta/creative-attribution";
import type { ResultMetricType } from "@/types/domain";

export interface AdDailyInsight {
  adId: string;
  date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  rawActions: Record<string, number>;
  rawActionValues: Record<string, number>;
}

export interface AdForCreative {
  adId: string;
  /** creative ATUAL do ad (meta_ads.creative_id) */
  currentCreativeId: string | null;
  updatedDate: string | null;
  campaignId: string | null;
  adsetId: string | null;
  name: string | null;
}

export interface AdCreativeObservation {
  adId: string;
  creativeId: string;
  firstSeen: string; // YYYY-MM-DD
  lastSeen: string; // YYYY-MM-DD
}

export interface CreativePerfInput {
  period: { start: string; end: string };
  today: string;
  resultType: ResultMetricType;
  ads: AdForCreative[];
  observations: AdCreativeObservation[];
  dailyInsights: AdDailyInsight[];
}

export type CreativeAttributionRollup = "complete" | "partial" | "unconfirmed";

export interface CreativePerfRow {
  creativeId: string;
  /** ad ids que já usaram este creative (observados) */
  adIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  /** confiança agregada do creative no período */
  attribution: CreativeAttributionRollup;
  /** por ad: estado observacional */
  adAttribution: { adId: string; status: AttributionStatus }[];
  /** totais agregados SÓ dos dias atribuíveis */
  totals: MetricTotals;
  metrics: {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
  } & Record<(typeof RELEASED_CONVERSION_METRICS)[number], number | null>;
  /** o que ficou de FORA por incerteza histórica */
  excluded: {
    spend: number;
    days: number;
    ads: number;
    byReason: Partial<Record<ExclusionReason, number>>;
  };
  /** teve algum gasto atribuível no período? */
  hasPeriodPerformance: boolean;
}

function emptyTotals(): MetricTotals {
  return {
    spend: null,
    impressions: null,
    clicks: null,
    inline_link_clicks: null,
    reach: null,
    frequency: null,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
  };
}

const addN = (a: number | null, b: number | null) =>
  a == null && b == null ? null : (a ?? 0) + (b ?? 0);

/** Agrega os insights nível ad em linhas por creative, com atribuição por dia. */
export function buildCreativePerformance(
  input: CreativePerfInput,
): CreativePerfRow[] {
  const { period, today, resultType, ads, observations, dailyInsights } = input;

  const adById = new Map(ads.map((a) => [a.adId, a]));

  // observações por ad e por creative
  const relByAd = new Map<string, Map<string, ObservedRelation>>();
  for (const o of observations) {
    let m = relByAd.get(o.adId);
    if (!m) relByAd.set(o.adId, (m = new Map()));
    m.set(o.creativeId, { firstSeen: o.firstSeen, lastSeen: o.lastSeen });
  }

  // insights por ad -> por data
  const insByAd = new Map<string, Map<string, AdDailyInsight>>();
  for (const r of dailyInsights) {
    let m = insByAd.get(r.adId);
    if (!m) insByAd.set(r.adId, (m = new Map()));
    // várias linhas do mesmo ad/data (raro) -> soma
    const cur = m.get(r.date);
    if (!cur) m.set(r.date, { ...r });
    else {
      cur.spend = addN(cur.spend, r.spend);
      cur.impressions = addN(cur.impressions, r.impressions);
      cur.clicks = addN(cur.clicks, r.clicks);
      cur.rawActions = sumRawMaps([cur.rawActions, r.rawActions]);
      cur.rawActionValues = sumRawMaps([cur.rawActionValues, r.rawActionValues]);
    }
  }

  // creative -> ads que o observaram
  const adsByCreative = new Map<string, Set<string>>();
  for (const o of observations) {
    let s = adsByCreative.get(o.creativeId);
    if (!s) adsByCreative.set(o.creativeId, (s = new Set()));
    s.add(o.adId);
  }

  const rows: CreativePerfRow[] = [];

  for (const [creativeId, adSet] of adsByCreative) {
    const totals = emptyTotals();
    let rawActions: Record<string, number> = {};
    let rawActionValues: Record<string, number> = {};
    let attributableSpend = 0;
    const excludedByReason: Partial<Record<ExclusionReason, number>> = {};
    let excludedSpend = 0;
    let excludedDays = 0;
    let excludedAds = 0;

    const adAttribution: { adId: string; status: AttributionStatus }[] = [];
    const campaignIds = new Set<string>();
    const adsetIds = new Set<string>();
    let anyFullyOrPartial = false;
    let allFully = true;

    for (const adId of adSet) {
      const ad = adById.get(adId);
      const rels = relByAd.get(adId) ?? new Map<string, ObservedRelation>();
      const relation = rels.get(creativeId) ?? null;
      const otherRelations = [...rels.entries()]
        .filter(([cid]) => cid !== creativeId)
        .map(([, r]) => r);

      const win = attributeAdToCreative({
        period,
        today,
        relation,
        otherRelations,
        adUpdatedDate: ad?.updatedDate ?? null,
      });
      adAttribution.push({ adId, status: win.status });
      if (win.status !== "FULLY_ATTRIBUTABLE") allFully = false;
      if (win.status !== "UNATTRIBUTABLE") anyFullyOrPartial = true;

      if (ad?.campaignId) campaignIds.add(ad.campaignId);
      if (ad?.adsetId) adsetIds.add(ad.adsetId);

      const ins = insByAd.get(adId) ?? new Map<string, AdDailyInsight>();
      const attributable = new Set(win.attributableDates);

      let adHadExcludedDay = false;
      for (const [date, row] of ins) {
        if (date < period.start || date > period.end) continue;
        if (attributable.has(date)) {
          totals.spend = addN(totals.spend, row.spend);
          totals.impressions = addN(totals.impressions, row.impressions);
          totals.clicks = addN(totals.clicks, row.clicks);
          rawActions = sumRawMaps([rawActions, row.rawActions]);
          rawActionValues = sumRawMaps([rawActionValues, row.rawActionValues]);
          attributableSpend += row.spend ?? 0;
        } else {
          adHadExcludedDay = true;
          excludedSpend += row.spend ?? 0;
          excludedDays += 1;
        }
      }
      // motivos: conta 1 por dia excluído do período (mesmo sem insight)
      for (const ex of win.excluded) {
        excludedByReason[ex.reason] = (excludedByReason[ex.reason] ?? 0) + 1;
      }
      if (win.status === "UNATTRIBUTABLE" || adHadExcludedDay) excludedAds += 1;
    }

    // re-resolve canônicas a partir dos crus agregados (reflete mapeamento atual)
    const convTotals = conversionTotalsFromRow({
      spend: totals.spend,
      raw_actions: rawActions,
      raw_action_values: rawActionValues,
    });
    totals.actions = convTotals.actions;
    totals.actionValues = convTotals.actionValues;

    const conv = {} as Record<
      (typeof RELEASED_CONVERSION_METRICS)[number],
      number | null
    >;
    for (const id of RELEASED_CONVERSION_METRICS) {
      conv[id] = conversionMetricValue(id, convTotals, resultType);
    }

    const attribution: CreativeAttributionRollup = !anyFullyOrPartial
      ? "unconfirmed"
      : allFully && excludedDays === 0
        ? "complete"
        : "partial";

    rows.push({
      creativeId,
      adIds: [...adSet],
      campaignIds: [...campaignIds],
      adsetIds: [...adsetIds],
      attribution,
      adAttribution,
      totals,
      metrics: {
        spend: totals.spend,
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr: computeMetric("ctr", totals),
        cpc: computeMetric("cpc", totals),
        cpm: computeMetric("cpm", totals),
        ...conv,
      },
      excluded: {
        spend: Math.round(excludedSpend * 100) / 100,
        days: excludedDays,
        ads: excludedAds,
        byReason: excludedByReason,
      },
      hasPeriodPerformance: attributableSpend > 0,
    });
  }

  return rows;
}
