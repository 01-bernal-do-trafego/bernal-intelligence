import type { ResultMetricType } from "@/types/domain";

/**
 * ÚNICO ponto que conhece os nomes crus de `action_type` da Meta.
 *
 * A Meta devolve conversões/eventos em arrays `actions[]` / `action_values[]`
 * com `action_type` variados (`purchase`, `omni_purchase`,
 * `offsite_conversion.fct.lead`, ...). Aqui mapeamos para ids de métrica
 * estáveis do Bernal. Uma mudança futura na API afeta só este arquivo + o
 * normalizer — nunca os componentes.
 */

/** `action_type` da Meta -> id de métrica Bernal (contagem). */
export const ACTION_TYPE_MAP: Readonly<Record<string, string>> = {
  lead: "leads",
  "offsite_conversion.fct.lead": "leads",
  "onsite_conversion.lead_grouped": "leads",

  purchase: "purchases",
  omni_purchase: "purchases",
  "offsite_conversion.fct.purchase": "purchases",

  "onsite_conversion.messaging_conversation_started_7d": "conversations",
  "onsite_conversion.total_messaging_connection": "conversations",

  complete_registration: "registrations",
  "offsite_conversion.fct.complete_registration": "registrations",

  schedule: "appointments",
  "onsite_conversion.schedule_total": "appointments",

  add_to_cart: "add_to_cart",
  omni_add_to_cart: "add_to_cart",

  initiate_checkout: "initiate_checkout",
  omni_initiated_checkout: "initiate_checkout",

  landing_page_view: "landing_page_views",
  link_click: "link_clicks",
};

/** `action_type` que carrega valor monetário -> id de métrica de valor. */
export const ACTION_VALUE_TYPE_MAP: Readonly<Record<string, string>> = {
  purchase: "revenue",
  omni_purchase: "revenue",
  "offsite_conversion.fct.purchase": "revenue",
};

/**
 * `action_type`s que compõem o "resultado principal" de um cliente conforme
 * o tipo configurado em `dashboard_configs.result_metric`. `results`/`custom`
 * ficam vazios: o evento específico será escolhido pelo cliente numa fase
 * futura (sem fonte definida = métrica ausente, não zero).
 */
export const RESULT_METRIC_ACTION_TYPES: Readonly<
  Record<ResultMetricType, string[]>
> = {
  leads: ["lead", "offsite_conversion.fct.lead", "onsite_conversion.lead_grouped"],
  purchases: ["purchase", "omni_purchase", "offsite_conversion.fct.purchase"],
  conversations: [
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.total_messaging_connection",
  ],
  registrations: [
    "complete_registration",
    "offsite_conversion.fct.complete_registration",
  ],
  appointments: ["schedule", "onsite_conversion.schedule_total"],
  results: [],
  custom: [],
};

export function bernalMetricForAction(actionType: string): string | undefined {
  return ACTION_TYPE_MAP[actionType];
}

export function bernalValueMetricForAction(actionType: string): string | undefined {
  return ACTION_VALUE_TYPE_MAP[actionType];
}

/** Todos os `action_type`s que alimentam uma métrica Bernal. */
export function actionTypesForMetric(metricId: string): string[] {
  return Object.entries(ACTION_TYPE_MAP)
    .filter(([, id]) => id === metricId)
    .map(([actionType]) => actionType);
}
