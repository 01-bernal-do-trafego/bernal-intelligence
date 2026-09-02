import type { ResultMetricType } from "@/types/domain";
import { META_DEFAULT_ATTRIBUTION_WINDOW } from "./config";
import {
  ACTION_TYPE_MAP,
  ACTION_VALUE_TYPE_MAP,
  RESULT_METRIC_ACTION_TYPES,
} from "./action-type-map";
import { metaTimeToISODate, parseMetaInt, parseMetaNumber } from "./parse";
import type {
  MetaActionRaw,
  MetaInsightLevel,
  MetaInsightRaw,
  NormalizedInsightRow,
} from "./types";

/**
 * Transforma UMA linha crua de insights da Meta em uma linha normalizada do
 * Bernal. Nada aqui inventa valores: ausência vira `null`; `action_type`s
 * desconhecidos vão para `unmappedActions` (auditoria), não somem.
 *
 * `Meta response → Normalizer → Metric Registry → Dashboard`.
 */

export interface NormalizeOptions {
  level: MetaInsightLevel;
  adAccountId: string; // "act_123..."
  attributionWindow?: string;
  currency?: string | null;
  /** Tipo de resultado configurado do cliente — define quais actions somam em `results`. */
  clientResultMetricType?: ResultMetricType;
}

function pickWindowValue(action: MetaActionRaw, attributionWindow: string): number {
  const raw = action[attributionWindow] ?? action.value;
  return parseMetaNumber(raw) ?? 0;
}

function firstActionValue(actions: MetaActionRaw[] | undefined): number | null {
  if (!actions || actions.length === 0) return null;
  return parseMetaNumber(actions[0]?.value);
}

function entityIdForLevel(
  raw: MetaInsightRaw,
  level: MetaInsightLevel,
  fallbackAdAccountId: string,
): string {
  switch (level) {
    case "account":
      return raw.account_id ? `act_${raw.account_id}` : fallbackAdAccountId;
    case "campaign":
      return raw.campaign_id ?? "";
    case "adset":
      return raw.adset_id ?? "";
    case "ad":
      return raw.ad_id ?? "";
  }
}

export function normalizeInsightRow(
  raw: MetaInsightRaw,
  opts: NormalizeOptions,
): NormalizedInsightRow | null {
  const date = metaTimeToISODate(raw.date_start);
  if (!date) return null;

  const entityId = entityIdForLevel(raw, opts.level, opts.adAccountId);
  if (!entityId) return null;

  const attributionWindow =
    opts.attributionWindow ?? META_DEFAULT_ATTRIBUTION_WINDOW;

  const actions: Record<string, number> = {};
  const actionValues: Record<string, number> = {};
  const unmappedActions: { actionType: string; value: number }[] = [];

  const resultActionTypes = new Set(
    opts.clientResultMetricType
      ? (RESULT_METRIC_ACTION_TYPES[opts.clientResultMetricType] ?? [])
      : [],
  );

  for (const action of raw.actions ?? []) {
    const value = pickWindowValue(action, attributionWindow);
    if (value === 0) continue;

    const metricId = ACTION_TYPE_MAP[action.action_type];
    if (metricId) {
      actions[metricId] = (actions[metricId] ?? 0) + value;
    } else {
      unmappedActions.push({ actionType: action.action_type, value });
    }

    if (resultActionTypes.has(action.action_type)) {
      actions.results = (actions.results ?? 0) + value;
    }
  }

  for (const actionValue of raw.action_values ?? []) {
    const value = pickWindowValue(actionValue, attributionWindow);
    if (value === 0) continue;
    const valueMetricId = ACTION_VALUE_TYPE_MAP[actionValue.action_type];
    if (valueMetricId) {
      actionValues[valueMetricId] = (actionValues[valueMetricId] ?? 0) + value;
    }
  }

  return {
    level: opts.level,
    entityId,
    adAccountId: opts.adAccountId,
    campaignId: raw.campaign_id ?? null,
    adsetId: raw.adset_id ?? null,
    adId: raw.ad_id ?? null,
    date,
    attributionWindow,
    currency: opts.currency ?? null,

    spend: parseMetaNumber(raw.spend),
    impressions: parseMetaInt(raw.impressions),
    reach: parseMetaInt(raw.reach),
    clicks: parseMetaInt(raw.clicks),
    inlineLinkClicks: parseMetaInt(raw.inline_link_clicks),
    frequency: parseMetaNumber(raw.frequency),
    video3sViews: parseMetaInt(firstActionValue(raw.video_3_sec_watched_actions)),
    videoThruplays: parseMetaInt(
      firstActionValue(raw.video_thruplay_watched_actions),
    ),
    videoAvgTimeWatched: firstActionValue(raw.video_avg_time_watched_actions),

    actions,
    actionValues,
    unmappedActions,
  };
}

/** Converte uma linha normalizada nos totais que o registry consome. */
export function insightRowToTotals(row: NormalizedInsightRow): {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  frequency: number | null;
  video_3s_views: number | null;
  video_thruplays: number | null;
  video_avg_time_watched: number | null;
  actions: Record<string, number>;
  actionValues: Record<string, number>;
} {
  return {
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    inline_link_clicks: row.inlineLinkClicks,
    frequency: row.frequency,
    video_3s_views: row.video3sViews,
    video_thruplays: row.videoThruplays,
    video_avg_time_watched: row.videoAvgTimeWatched,
    actions: { ...row.actions },
    actionValues: { ...row.actionValues },
  };
}
