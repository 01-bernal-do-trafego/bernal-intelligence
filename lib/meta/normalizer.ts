import type { ResultMetricType } from "@/types/domain";
import { META_DEFAULT_ATTRIBUTION_WINDOW } from "./config";
import {
  ACTION_METRIC_SPECS,
  ACTION_VALUE_METRIC_SPECS,
  resolveActionMetric,
  resolveResultMetric,
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
 * Bernal. Nada aqui inventa valores: ausência vira `null`.
 *
 * ── ANTI DUPLA CONTAGEM ──────────────────────────────────────────────────
 * `rawActions` / `rawActionValues` preservam TODOS os `action_type` recebidos
 * (valor já resolvido para a janela de atribuição). As métricas Bernal em
 * `actions` / `actionValues` são derivadas por PRIORIDADE/fallback (ver
 * `action-type-map.ts`) — nunca somando aliases sobrepostos. Assim o total do
 * Bernal bate com o Ads Manager dentro das regras de atribuição configuradas.
 *
 * `Meta response → Normalizer → Metric Registry → Dashboard`.
 */

export interface NormalizeOptions {
  level: MetaInsightLevel;
  adAccountId: string; // "act_123..."
  attributionWindow?: string;
  currency?: string | null;
  /** Tipo de resultado configurado do cliente — define a fonte de `results`. */
  clientResultMetricType?: ResultMetricType;
}

function pickWindowValue(
  action: MetaActionRaw,
  attributionWindow: string,
): number {
  const raw = action[attributionWindow] ?? action.value;
  return parseMetaNumber(raw) ?? 0;
}

/**
 * `{ action_type -> valor resolvido para a janela }`. Preserva TODOS os
 * `action_type` — inclusive os com valor 0 (zero medido é dado legítimo).
 */
function collectRawActions(
  actions: MetaActionRaw[] | undefined,
  attributionWindow: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const action of actions ?? []) {
    if (!action?.action_type) continue;
    out.set(action.action_type, pickWindowValue(action, attributionWindow));
  }
  return out;
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

const CLAIMED_ACTION_TYPES = new Set<string>(
  ACTION_METRIC_SPECS.flatMap((s) => [...s.actionTypes]),
);

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

  // 1. Preserva tudo o que a Meta mandou (resolvido para a janela).
  const rawActions = collectRawActions(raw.actions, attributionWindow);
  const rawActionValues = collectRawActions(
    raw.action_values,
    attributionWindow,
  );

  // 2. Métricas Bernal por PRIORIDADE/fallback — sem somar aliases sobrepostos.
  const actions: Record<string, number> = {};
  for (const spec of ACTION_METRIC_SPECS) {
    const value = resolveActionMetric(spec.actionTypes, rawActions, spec.combine);
    if (value !== null) actions[spec.metricId] = value;
  }

  const actionValues: Record<string, number> = {};
  for (const spec of ACTION_VALUE_METRIC_SPECS) {
    const value = resolveActionMetric(
      spec.actionTypes,
      rawActionValues,
      spec.combine,
    );
    if (value !== null) actionValues[spec.metricId] = value;
  }

  // 3. Resultado principal do cliente (também por prioridade).
  if (opts.clientResultMetricType) {
    const result = resolveResultMetric(opts.clientResultMetricType, rawActions);
    if (result !== null) actions.results = result;
  }

  // 4. Auditoria: `action_type`s crus (não-zero) que nenhum spec reivindica.
  const unmappedActions = [...rawActions.entries()]
    .filter(([actionType, value]) => value !== 0 && !CLAIMED_ACTION_TYPES.has(actionType))
    .map(([actionType, value]) => ({ actionType, value }));

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
    video3sViews: parseMetaInt(
      firstActionValue(raw.video_3_sec_watched_actions),
    ),
    videoThruplays: parseMetaInt(
      firstActionValue(raw.video_thruplay_watched_actions),
    ),
    videoAvgTimeWatched: firstActionValue(raw.video_avg_time_watched_actions),

    actions,
    actionValues,
    rawActions: Object.fromEntries(rawActions),
    rawActionValues: Object.fromEntries(rawActionValues),
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
