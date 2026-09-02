import type { ResultMetricType } from "@/types/domain";

/**
 * ÚNICO ponto que conhece os nomes crus de `action_type` da Meta.
 *
 * ── ESTRATÉGIA CONTRA DUPLA CONTAGEM ──────────────────────────────────────
 * A Meta reporta o MESMO evento lógico por vários `action_type` que se
 * SOBREPÕEM semanticamente:
 *   omni_purchase  ⊇  purchase  ⊇  offsite_conversion.fct.purchase
 *   lead           ⊇  offsite_conversion.fct.lead / onsite_conversion.lead_grouped
 * Somar esses aliases infla o número (uma compra vira 2–3). Então cada métrica
 * Bernal declara uma LISTA ORDENADA POR PRIORIDADE de `action_type` + um modo:
 *
 *   combine: "priority" (padrão)
 *     usa o valor do PRIMEIRO `action_type` presente na resposta — é o que o
 *     Ads Manager faz nas colunas unificadas. NÃO soma sobreposições.
 *
 *   combine: "sum"
 *     soma os `action_type` da lista. Só quando forem eventos comprovadamente
 *     INDEPENDENTES e ADITIVOS. Nenhum caso hoje — todos os grupos são
 *     aliases/superconjuntos.
 *
 * O normalizer SEMPRE preserva todos os `action_type` crus (já resolvidos para
 * a janela de atribuição) em `rawActions` / `rawActionValues`. Nada é perdido:
 * dá para reconciliar com o Ads Manager e criar métricas novas sem re-sync.
 * Uma mudança futura na API afeta só este arquivo + o normalizer.
 */

export type ActionCombine = "priority" | "sum";

export interface ActionMetricSpec {
  /** id de métrica Bernal (bate com o Metric Registry). */
  metricId: string;
  /** `action_type` da Meta em ordem de PRIORIDADE (fallback). */
  actionTypes: readonly string[];
  combine: ActionCombine;
  /** por que essa ordem — documenta a decisão de sobreposição. */
  note?: string;
}

/** Contagem de conversões (array `actions[]` da resposta de insights). */
export const ACTION_METRIC_SPECS: readonly ActionMetricSpec[] = [
  {
    metricId: "purchases",
    actionTypes: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"],
    combine: "priority",
    note: "omni_purchase é o evento unificado do Ads Manager; os demais são subconjuntos dele.",
  },
  {
    metricId: "leads",
    actionTypes: [
      "lead",
      "offsite_conversion.fct.lead",
      "onsite_conversion.lead_grouped",
    ],
    combine: "priority",
    note: "`lead` já agrega formulários on-Meta + offsite; os outros são o mesmo evento por outro pipe.",
  },
  {
    metricId: "conversations",
    actionTypes: [
      "onsite_conversion.messaging_conversation_started_7d",
      "onsite_conversion.total_messaging_connection",
    ],
    combine: "priority",
    note: "mesma conversa de mensagem, granularidades diferentes.",
  },
  {
    metricId: "registrations",
    actionTypes: [
      "complete_registration",
      "offsite_conversion.fct.complete_registration",
    ],
    combine: "priority",
  },
  {
    metricId: "appointments",
    actionTypes: ["schedule", "onsite_conversion.schedule_total"],
    combine: "priority",
  },
  {
    metricId: "add_to_cart",
    actionTypes: [
      "omni_add_to_cart",
      "add_to_cart",
      "offsite_conversion.fct.add_to_cart",
    ],
    combine: "priority",
  },
  {
    metricId: "initiate_checkout",
    actionTypes: [
      "omni_initiated_checkout",
      "initiate_checkout",
      "offsite_conversion.fct.initiate_checkout",
    ],
    combine: "priority",
  },
  {
    metricId: "landing_page_views",
    actionTypes: ["landing_page_view"],
    combine: "priority",
  },
  {
    metricId: "link_clicks",
    actionTypes: ["link_click"],
    combine: "priority",
  },
];

/** Valor monetário (array `action_values[]`). */
export const ACTION_VALUE_METRIC_SPECS: readonly ActionMetricSpec[] = [
  {
    metricId: "revenue",
    actionTypes: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"],
    combine: "priority",
    note: "valor de compra — mesma prioridade da contagem de compras.",
  },
];

/**
 * `action_type`s do "resultado principal" por tipo configurado do cliente
 * (`dashboard_configs.result_metric`), EM ORDEM DE PRIORIDADE. `results` é
 * sempre resolvido por prioridade — nunca soma. `results` / `custom` ficam
 * vazios: o evento é escolhido pelo cliente numa fase futura (sem fonte =
 * métrica ausente, não zero).
 */
export const RESULT_METRIC_ACTION_TYPES: Readonly<
  Record<ResultMetricType, readonly string[]>
> = {
  leads: [
    "lead",
    "offsite_conversion.fct.lead",
    "onsite_conversion.lead_grouped",
  ],
  purchases: ["omni_purchase", "purchase", "offsite_conversion.fct.purchase"],
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

/* ----------------------------- índices / lookup ------------------------- */

const COUNT_BY_METRIC = new Map<string, ActionMetricSpec>(
  ACTION_METRIC_SPECS.map((s) => [s.metricId, s]),
);
const VALUE_BY_METRIC = new Map<string, ActionMetricSpec>(
  ACTION_VALUE_METRIC_SPECS.map((s) => [s.metricId, s]),
);

/** Todos os `action_type` (contagem) que alimentam uma métrica Bernal. */
export function actionTypesForMetric(metricId: string): string[] {
  return [...(COUNT_BY_METRIC.get(metricId)?.actionTypes ?? [])];
}

/** Todos os `action_type` (valor) que alimentam uma métrica de valor Bernal. */
export function valueActionTypesForMetric(metricId: string): string[] {
  return [...(VALUE_BY_METRIC.get(metricId)?.actionTypes ?? [])];
}

/** `combine` configurado para a métrica de contagem (default "priority"). */
export function combineForMetric(metricId: string): ActionCombine {
  return COUNT_BY_METRIC.get(metricId)?.combine ?? "priority";
}

/** Métrica Bernal (contagem) para um `action_type` cru, se conhecida. */
export function bernalMetricForAction(actionType: string): string | undefined {
  return ACTION_METRIC_SPECS.find((s) => s.actionTypes.includes(actionType))
    ?.metricId;
}

/** Métrica de valor Bernal para um `action_type` cru, se conhecida. */
export function bernalValueMetricForAction(
  actionType: string,
): string | undefined {
  return ACTION_VALUE_METRIC_SPECS.find((s) =>
    s.actionTypes.includes(actionType),
  )?.metricId;
}

/** `true` se algum spec de contagem conhece esse `action_type`. */
export function isKnownActionType(actionType: string): boolean {
  return ACTION_METRIC_SPECS.some((s) => s.actionTypes.includes(actionType));
}

/**
 * Resolve UMA métrica lógica a partir do mapa
 * `{ action_type -> valor (já resolvido para a janela de atribuição) }`.
 *
 *   "priority" -> valor do PRIMEIRO `action_type` presente (mesmo que seja 0).
 *   "sum"      -> soma dos `action_type` presentes.
 *
 * Retorna `null` quando NENHUM `action_type` da lista está presente
 * (ausência ≠ zero).
 */
export function resolveActionMetric(
  actionTypes: readonly string[],
  present: ReadonlyMap<string, number>,
  combine: ActionCombine = "priority",
): number | null {
  if (combine === "priority") {
    for (const at of actionTypes) {
      const v = present.get(at);
      if (v !== undefined) return v;
    }
    return null;
  }
  let total = 0;
  let seen = false;
  for (const at of actionTypes) {
    const v = present.get(at);
    if (v !== undefined) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

/** Resultado principal do cliente — sempre por PRIORIDADE (nunca soma). */
export function resolveResultMetric(
  resultType: ResultMetricType,
  present: ReadonlyMap<string, number>,
): number | null {
  return resolveActionMetric(
    RESULT_METRIC_ACTION_TYPES[resultType] ?? [],
    present,
    "priority",
  );
}
