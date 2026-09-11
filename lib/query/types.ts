/**
 * DATA FOUNDATION V2.1 — Query Layer. Tipos compartilhados. Módulo PURO.
 *
 * A Query Layer nasce EM PARALELO ao runtime V1
 * (`server/real-dashboard.ts` / `server/agency-overview.ts`). Ninguém a chama
 * ainda — é a base para os blocos seguintes (builder, funil, ranking,
 * Intelligence). Nenhuma tela muda nesta fase.
 *
 * Nenhum consumidor futuro precisa saber qual coluna SQL representa a
 * métrica, se é `action_type`, se é fórmula, se é aditiva, se precisa do
 * agregado periódico ou como tratar zero/no_data — isso é resolvido aqui e no
 * Metric Registry (`lib/metrics/registry.ts` + `lib/metrics/aggregation.ts`).
 */

import type { DataQuality } from "@/lib/data-quality";
import type { ResultMetricType } from "@/types/domain";

/** Níveis suportados pela Query Layer nesta fase. `creative_analysis` fica
 * fora — o Creative Ranking continua na camada atual (`lib/meta/creative-*`). */
export type EntityLevel = "account" | "campaign" | "adset" | "ad";

/**
 * Intervalo de datas `{ from, to }` (YYYY-MM-DD, inclusivo). Deliberadamente
 * NÃO é um preset (`last_7d`, `this_month`...) — a Query Layer não conhece
 * presets; resolver um preset num `DateRange` é responsabilidade de quem
 * chama (hoje `lib/meta/date-preset.ts`; futuramente também custom ranges,
 * DATA V2.3).
 */
export interface DateRange {
  from: string;
  to: string;
}

/** `clientId` + nível + entidades no escopo. As 3 coisas variam juntas. */
export interface QueryScope {
  clientId: string;
  level: EntityLevel;
  /** ids Meta (`entity_id`) no escopo — 1 entidade, ou N para "todas as contas". */
  entityIds: readonly string[];
}

/**
 * Campos comuns de uma linha de insight NORMALIZADA — mesmo nome de coluna do
 * banco (`meta_insights_daily` / `meta_insights_periodic`), para que um
 * adapter real (V2.2+) precise de mapeamento mínimo.
 */
export interface NormalizedInsightRow {
  client_id: string;
  level: EntityLevel;
  entity_id: string;
  attribution_window: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  reach: number | null;
  frequency: number | null;
  video_3s_views: number | null;
  video_thruplays: number | null;
  video_avg_time_watched: number | null;
  actions: Record<string, number> | null;
  action_values: Record<string, number> | null;
  raw_actions: Record<string, number> | null;
  raw_action_values: Record<string, number> | null;
}

/** Linha de `meta_insights_daily` normalizada. */
export interface NormalizedDailyRow extends NormalizedInsightRow {
  date: string;
}

/** Linha de `meta_insights_periodic` normalizada. */
export interface NormalizedPeriodicRow extends NormalizedInsightRow {
  date_from: string;
  date_to: string;
  period_key: string;
}

/** Contexto de "resultado principal" (config-driven) — de `dashboard_configs.result_metric`. */
export interface ResultMetricContext {
  resultMetric: ResultMetricType | null;
}

/** Valor resolvido de UMA métrica para um recorte (totais). */
export interface MetricValueResult {
  metricId: string;
  value: number | null;
  quality: DataQuality;
}

export interface SeriesPoint {
  date: string;
  values: Readonly<Record<string, number | null>>;
}

/** Série temporal diária de várias métricas. Qualidade é do RANGE inteiro
 * (por dia, ausência de linha já vira `null` nos `values` — ver `resolveMetricSeries`). */
export interface MetricSeriesResult {
  range: DateRange;
  points: readonly SeriesPoint[];
  quality: DataQuality;
}

/** Comparação entre período atual e anterior de UMA métrica. */
export interface MetricComparisonResult {
  metricId: string;
  current: number | null;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

/**
 * PORTA (seam) para um futuro adapter de leitura — separa "acesso ao banco"
 * de "resolução matemática". `resolveMetricTotals`/`resolveMetricSeries` são
 * PUROS e recebem as linhas já buscadas; esta interface documenta o contrato
 * que um adapter real (Supabase, DATA V2.2/V2.3) implementaria.
 *
 * NÃO implementada nesta fase — nenhum consumidor real ainda; construir uma
 * implementação sem um chamador real significa código não testado de verdade.
 * O adapter real deve sempre filtrar por `client_id` + `level` + intervalo de
 * data (+ entidade quando aplicável) NA QUERY — nunca `select *` sem range.
 */
export interface InsightsReader {
  getDailyRows(args: {
    scope: QueryScope;
    range: DateRange;
  }): Promise<NormalizedDailyRow[]>;
  getPeriodicRows(args: {
    scope: QueryScope;
    range: DateRange;
  }): Promise<NormalizedPeriodicRow[]>;
}
