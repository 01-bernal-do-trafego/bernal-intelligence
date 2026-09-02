/**
 * Normalização das MÉTRICAS BASE de insights para a primeira sincronização
 * real (META 5). Módulo PURO.
 *
 * Escopo desta etapa: spend, impressions, reach, clicks, inline_link_clicks,
 * frequency. Sem `actions`/`action_values` (conversões vêm depois). O
 * normalizer completo (com resolução de conversões por prioridade) continua em
 * `lib/meta/normalizer.ts`; aqui é a fatia mínima, e a Edge Function tem uma
 * cópia espelho em `supabase/functions/_shared/insights.ts`.
 *
 * REGRAS QUE CONTINUAM VALENDO:
 *  - `reach` NÃO é somável por dia — o total de período vem de
 *    `meta_insights_periodic`. `sumDailyAdditive()` deliberadamente NÃO
 *    devolve reach/frequency.
 *  - ausência de campo => `null` (nunca 0 inventado).
 *  - CTR/CPC/CPM são calculados sobre TOTAIS BRUTOS (via lib/metrics/compute).
 */

import { META_DEFAULT_ATTRIBUTION_WINDOW } from "./config";
import { metaTimeToISODate, parseMetaInt, parseMetaNumber } from "./parse";
import type { MetaInsightLevel } from "./types";
import type { MetricTotals } from "@/lib/metrics/compute";

export interface BaseInsightRow {
  level: MetaInsightLevel;
  /** id Meta da entidade do nível (`act_<n>` p/ account). */
  entityId: string;
  adAccountId: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  /** `YYYY-MM-DD` para linha diária; `null` para agregado de período. */
  date: string | null;
  dateStart: string | null;
  dateStop: string | null;
  attributionWindow: string;
  currency: string | null;

  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
  frequency: number | null;
}

export interface NormalizeBaseOptions {
  level: MetaInsightLevel;
  /** `act_<n>` */
  adAccountId: string;
  attributionWindow?: string;
  currency?: string | null;
  /** `true` p/ linha de `meta_insights_periodic` (sem `time_increment`). */
  periodic?: boolean;
}

function entityIdForLevel(
  raw: Record<string, unknown>,
  level: MetaInsightLevel,
  fallbackAdAccountId: string,
): string {
  switch (level) {
    case "account":
      return typeof raw.account_id === "string"
        ? `act_${raw.account_id}`
        : fallbackAdAccountId;
    case "campaign":
      return typeof raw.campaign_id === "string" ? raw.campaign_id : "";
    case "adset":
      return typeof raw.adset_id === "string" ? raw.adset_id : "";
    case "ad":
      return typeof raw.ad_id === "string" ? raw.ad_id : "";
  }
}

/**
 * Uma linha crua de `/insights` -> BaseInsightRow. `null` se não der para
 * identificar a entidade, ou se for linha diária sem `date_start`.
 */
export function normalizeBaseInsight(
  input: unknown,
  opts: NormalizeBaseOptions,
): BaseInsightRow | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;

  const entityId = entityIdForLevel(raw, opts.level, opts.adAccountId);
  if (!entityId) return null;

  const dateStart = metaTimeToISODate(raw.date_start);
  const dateStop = metaTimeToISODate(raw.date_stop);
  if (!opts.periodic && !dateStart) return null;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  return {
    level: opts.level,
    entityId,
    adAccountId: opts.adAccountId,
    campaignId: str(raw.campaign_id),
    adsetId: str(raw.adset_id),
    adId: str(raw.ad_id),
    date: opts.periodic ? null : dateStart,
    dateStart,
    dateStop,
    attributionWindow: opts.attributionWindow ?? META_DEFAULT_ATTRIBUTION_WINDOW,
    currency: opts.currency ?? null,

    spend: parseMetaNumber(raw.spend),
    impressions: parseMetaInt(raw.impressions),
    reach: parseMetaInt(raw.reach),
    clicks: parseMetaInt(raw.clicks),
    inlineLinkClicks: parseMetaInt(raw.inline_link_clicks),
    frequency: parseMetaNumber(raw.frequency),
  };
}

/** BaseInsightRow -> MetricTotals (para `computeMetric`). Sem conversões nesta etapa. */
export function baseInsightToTotals(row: BaseInsightRow): MetricTotals {
  return {
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    inline_link_clicks: row.inlineLinkClicks,
    frequency: row.frequency,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
  };
}

export interface AdditiveDailyTotals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
}

/**
 * Soma as métricas ADITIVAS das linhas diárias. NÃO devolve reach nem
 * frequency de propósito — esses vêm de `meta_insights_periodic`.
 * `null` só quando NENHUMA linha tinha o campo (ausência ≠ 0).
 */
export function sumDailyAdditive(
  rows: readonly BaseInsightRow[],
): AdditiveDailyTotals {
  const acc = {
    spend: null as number | null,
    impressions: null as number | null,
    clicks: null as number | null,
    inlineLinkClicks: null as number | null,
  };
  const add = (
    key: keyof AdditiveDailyTotals,
    value: number | null,
  ) => {
    if (value === null) return;
    acc[key] = (acc[key] ?? 0) + value;
  };
  for (const r of rows) {
    add("spend", r.spend);
    add("impressions", r.impressions);
    add("clicks", r.clicks);
    add("inlineLinkClicks", r.inlineLinkClicks);
  }
  return acc;
}
