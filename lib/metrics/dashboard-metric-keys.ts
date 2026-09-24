import { getMetricDefinition, type MetricFormat } from "./registry";

/**
 * `MetricKey` — chaves de `ClientDashboardData.metrics`/`DashboardCampaignRow.conversions`
 * (`server/client-dashboard.ts`). Módulo PURO (sem `"server-only"`) para que
 * testes de UI (render estático, sem compilador Next) possam importar a
 * lista de keys sem arrastar o módulo server-only inteiro — só o TIPO
 * `MetricKey` é reexportado de lá; os VALORES (as listas abaixo) vivem aqui.
 */
export type MetricKey =
  | "investment"
  | "results"
  | "cost_per_result"
  | "reach"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "frequency"
  // Mensageria liberada (validada com dados reais).
  | "messaging_conversations_started"
  | "cost_per_conversation"
  | "messaging_contacts_total"
  | "messaging_contacts_new"
  // FEATURE 02A: liberadas — pipeline já suportava, só faltava expor. O
  // conjunto canônico completo (card/chart/table eligibility) vive no Metric
  // Registry (`lib/metrics/registry.ts`, campo `dashboardSurfaces`); esta
  // union só precisa existir porque `ClientDashboardData.metrics` é
  // fortemente tipado — mudar aqui é o único lugar de tipo a tocar ao
  // liberar uma métrica já suportada pelo Registry.
  | "inline_link_clicks"
  | "ctr_link"
  | "cpc_link"
  | "leads"
  | "cpl"
  | "purchases"
  | "cpa"
  | "revenue"
  | "roas"
  | "landing_page_views"
  | "cost_per_landing_page_view"
  | "add_to_cart"
  | "cost_per_add_to_cart"
  | "initiate_checkout"
  | "cost_per_initiate_checkout"
  | "registrations"
  | "appointments"
  | "post_engagement"
  | "post_reactions"
  | "post_comments"
  | "post_saves"
  | "video_views"
  | "cost_per_video_view";

const ORIGINAL_METRIC_KEYS: readonly MetricKey[] = [
  "investment",
  "results",
  "cost_per_result",
  "reach",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "messaging_conversations_started",
  "cost_per_conversation",
  "messaging_contacts_total",
  "messaging_contacts_new",
];

/**
 * Keys liberadas pela FEATURE 02A — pipeline já suportava, só faltava expor.
 * Usada para preencher `metrics`/`conversions` nos modos que não calculam
 * cada métrica individualmente hoje (`demo`, `emptyDashboard`): evita ter
 * que listar as ~22 keys à mão em mais de um lugar.
 */
export const FEATURE_02A_METRIC_KEYS: readonly MetricKey[] = [
  "inline_link_clicks",
  "ctr_link",
  "cpc_link",
  "leads",
  "cpl",
  "purchases",
  "cpa",
  "revenue",
  "roas",
  "landing_page_views",
  "cost_per_landing_page_view",
  "add_to_cart",
  "cost_per_add_to_cart",
  "initiate_checkout",
  "cost_per_initiate_checkout",
  "registrations",
  "appointments",
  "post_engagement",
  "post_reactions",
  "post_comments",
  "post_saves",
  "video_views",
  "cost_per_video_view",
];

/** Todas as `MetricKey` — usada onde é preciso preencher o record inteiro
 * uniformemente (ver `emptyDashboard`), sem repetir a lista à mão. */
export const ALL_METRIC_KEYS: readonly MetricKey[] = [
  ...ORIGINAL_METRIC_KEYS,
  ...FEATURE_02A_METRIC_KEYS,
];

/** `format` da métrica no Registry (ou `"number"` — nunca deveria faltar para
 * uma key desta union, já que toda `MetricKey` tem entrada correspondente). */
export function metricFormatOf(key: MetricKey): MetricFormat {
  return getMetricDefinition(key)?.format ?? "number";
}
