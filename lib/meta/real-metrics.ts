/**
 * Cálculo das métricas reais do dashboard (V1) a partir das linhas já
 * sincronizadas. Módulo PURO.
 *
 * Métricas autorizadas nesta fase: spend, impressions, reach, frequency,
 * clicks, ctr, cpc, cpm. Conversões (results, leads, purchases, cpa, roas...)
 * NÃO entram aqui — fase própria.
 *
 * Regras:
 *  - aditivas (spend/impressions/clicks) => soma das linhas diárias;
 *  - derivadas (ctr/cpc/cpm) => `computeMetric` sobre os TOTAIS BRUTOS;
 *  - reach/frequency => SOMENTE do agregado de período da Meta; sem agregado
 *    => indisponível (nunca soma diário, nunca aproxima);
 *  - "Todas as contas" com >1 conta => reach/frequency NÃO consolidados.
 */

import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";

/** Métricas reais liberadas nesta fase. */
export const REAL_DASHBOARD_METRICS = [
  "investment",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
] as const;
export type RealDashboardMetric = (typeof REAL_DASHBOARD_METRICS)[number];

const REAL_SET = new Set<string>(REAL_DASHBOARD_METRICS);
/** id do card/coluna -> id de métrica do registry (`investment` -> `spend`). */
export function toRegistryMetricId(key: string): string {
  return key === "investment" ? "spend" : key;
}
/** A métrica configurada existe em dados reais nesta fase? */
export function isRealMetricAvailableThisPhase(key: string): boolean {
  return REAL_SET.has(key);
}

export interface DailyInsightLike {
  date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  inlineLinkClicks?: number | null;
  reach: number | null;
  frequency: number | null;
}

export interface AdditiveTotals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
}

/** Soma SÓ as métricas aditivas. NUNCA reach/frequency. */
export function sumDailyAdditive(
  rows: readonly DailyInsightLike[],
): AdditiveTotals {
  const acc: AdditiveTotals = {
    spend: null,
    impressions: null,
    clicks: null,
    inlineLinkClicks: null,
  };
  const add = (k: keyof AdditiveTotals, v: number | null | undefined) => {
    if (v == null) return;
    acc[k] = (acc[k] ?? 0) + v;
  };
  for (const r of rows) {
    add("spend", r.spend);
    add("impressions", r.impressions);
    add("clicks", r.clicks);
    add("inlineLinkClicks", r.inlineLinkClicks);
  }
  return acc;
}

export interface PeriodicReach {
  reach: number | null;
  frequency: number | null;
}

/**
 * `MetricTotals` para o `computeMetric`. Aditivas vêm da soma diária; reach/
 * frequency vêm do agregado de período (ou ficam `null` se ausente/não
 * consolidável).
 */
export function buildRealTotals(
  additive: AdditiveTotals,
  periodic: PeriodicReach | null,
): MetricTotals {
  return {
    spend: additive.spend,
    impressions: additive.impressions,
    clicks: additive.clicks,
    inline_link_clicks: additive.inlineLinkClicks,
    reach: periodic?.reach ?? null,
    frequency: periodic?.frequency ?? null,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
  };
}

/** Valor real de uma métrica do dashboard, ou `null` (indisponível). */
export function realMetricValue(
  key: string,
  totals: MetricTotals,
): number | null {
  return computeMetric(toRegistryMetricId(key), totals);
}

/**
 * reach/frequency só podem ser mostrados quando o escopo é UMA conta
 * (ou "todas" quando só há 1 conta vinculada). Entre contas diferentes a
 * Meta não deduplica pessoas -> não consolidar.
 */
export function reachIsConsolidable(args: {
  scope: "all" | "account" | "campaign";
  linkedAccountCount: number;
}): boolean {
  if (args.scope === "account" || args.scope === "campaign") return true;
  return args.linkedAccountCount <= 1;
}

export const REACH_MULTI_ACCOUNT_NOTE =
  "Alcance e frequência consolidados entre contas não são fornecidos de forma confiável pela Meta (a mesma pessoa pode ser contada em contas diferentes). Selecione uma conta específica.";

export const REACH_NOT_SYNCED_NOTE =
  "O alcance agregado deste período ainda não foi sincronizado. Rode “Sincronizar Meta”.";
