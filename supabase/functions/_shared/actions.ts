/**
 * Resolução de conversões (Edge Function / Deno) — CONVERSÕES REAIS V1.
 *
 * Espelho de `lib/meta/action-type-map.ts` + a fatia de conversões de
 * `lib/meta/normalizer.ts` do app (a versão do app é a TESTADA; mantenha as
 * duas idênticas se um `action_type` da Meta mudar).
 *
 * ANTI DUPLA CONTAGEM: cada métrica declara uma lista de `action_type` EM
 * ORDEM DE PRIORIDADE. `resolveActionMetric` usa o valor do PRIMEIRO presente
 * — nunca soma aliases (`omni_purchase` ⊇ `purchase` ⊇ `offsite_conversion…`).
 * `raw_actions` preserva TODOS os `action_type` crus para auditoria.
 * Ausência de fonte => `null` (diferente de `0` medido).
 */

interface Spec {
  metricId: string;
  actionTypes: string[];
  combine: "priority" | "sum";
}

export const ACTION_METRIC_SPECS: Spec[] = [
  { metricId: "purchases", actionTypes: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"], combine: "priority" },
  { metricId: "leads", actionTypes: ["lead", "offsite_conversion.fct.lead", "onsite_conversion.lead_grouped"], combine: "priority" },
  { metricId: "conversations", actionTypes: ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"], combine: "priority" },
  { metricId: "registrations", actionTypes: ["complete_registration", "offsite_conversion.fct.complete_registration"], combine: "priority" },
  { metricId: "appointments", actionTypes: ["schedule", "onsite_conversion.schedule_total"], combine: "priority" },
  { metricId: "add_to_cart", actionTypes: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fct.add_to_cart"], combine: "priority" },
  { metricId: "initiate_checkout", actionTypes: ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fct.initiate_checkout"], combine: "priority" },
  { metricId: "landing_page_views", actionTypes: ["landing_page_view"], combine: "priority" },
  { metricId: "link_clicks", actionTypes: ["link_click"], combine: "priority" },
];

export const ACTION_VALUE_METRIC_SPECS: Spec[] = [
  { metricId: "revenue", actionTypes: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"], combine: "priority" },
];

export const RESULT_METRIC_ACTION_TYPES: Record<string, string[]> = {
  leads: ["lead", "offsite_conversion.fct.lead", "onsite_conversion.lead_grouped"],
  purchases: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"],
  conversations: ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"],
  registrations: ["complete_registration", "offsite_conversion.fct.complete_registration"],
  appointments: ["schedule", "onsite_conversion.schedule_total"],
  results: [],
  custom: [],
};

const CLAIMED = new Set<string>(ACTION_METRIC_SPECS.flatMap((s) => s.actionTypes));

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `actions[]` cru da Meta -> `{ action_type: valor (padrão do anunciante) }`. */
export function collectRaw(arr: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(arr)) return out;
  for (const a of arr) {
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    const at = typeof rec.action_type === "string" ? rec.action_type : "";
    if (!at) continue;
    out[at] = toNum(rec.value) ?? 0;
  }
  return out;
}

function resolve(list: string[], present: Record<string, number>, combine: "priority" | "sum"): number | null {
  if (combine === "priority") {
    for (const at of list) if (at in present) return present[at];
    return null;
  }
  let total = 0;
  let seen = false;
  for (const at of list) if (at in present) { total += present[at]; seen = true; }
  return seen ? total : null;
}

export interface NormalizedActions {
  actions: Record<string, number>;
  action_values: Record<string, number>;
  raw_actions: Record<string, number>;
  raw_action_values: Record<string, number>;
}

/**
 * Resolve `actions`/`action_values` de UMA linha de insights.
 * `resultMetricType` (de dashboard_configs.result_metric) define a fonte de
 * `results` — se o evento configurado não veio, `results` NÃO é gravado.
 */
export function normalizeActions(
  rawActionsArr: unknown,
  rawActionValuesArr: unknown,
  resultMetricType?: string | null,
): NormalizedActions {
  const rawActions = collectRaw(rawActionsArr);
  const rawActionValues = collectRaw(rawActionValuesArr);

  const actions: Record<string, number> = {};
  for (const spec of ACTION_METRIC_SPECS) {
    const v = resolve(spec.actionTypes, rawActions, spec.combine);
    if (v !== null) actions[spec.metricId] = v;
  }

  const action_values: Record<string, number> = {};
  for (const spec of ACTION_VALUE_METRIC_SPECS) {
    const v = resolve(spec.actionTypes, rawActionValues, spec.combine);
    if (v !== null) action_values[spec.metricId] = v;
  }

  if (resultMetricType && RESULT_METRIC_ACTION_TYPES[resultMetricType]) {
    const v = resolve(RESULT_METRIC_ACTION_TYPES[resultMetricType], rawActions, "priority");
    if (v !== null) actions.results = v;
  }

  return { actions, action_values, raw_actions: rawActions, raw_action_values: rawActionValues };
}

/** `action_type` não reivindicado por nenhum spec (auditoria). */
export function isUnmappedAction(actionType: string): boolean {
  return !CLAIMED.has(actionType);
}
