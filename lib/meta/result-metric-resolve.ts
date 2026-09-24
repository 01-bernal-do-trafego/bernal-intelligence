/**
 * "Resultado principal" (results / cost_per_result) — resolvido EM LEITURA a
 * partir de `dashboard_configs.result_metric`. Módulo PURO.
 *
 * O sync NÃO persiste `results`: ele grava só métricas CANÔNICAS da Meta
 * (leads, conversations, purchases, revenue, …). `results` é config-driven —
 * mudar `result_metric` no editor muda os números na hora, sem novo sync.
 *
 *   dashboard_configs.result_metric.type
 *     -> métrica canônica correspondente (RESULT_METRIC_CANONICAL)
 *     -> valor dessa métrica no período (totals.actions[<canônica>])
 *     -> exibido como "Resultados"
 *
 * `results`/`custom` não têm canônica definida -> `null` (indisponível), nunca
 * substituído por outra métrica.
 */

import type { MetricTotals } from "@/lib/metrics/compute";
import { computeMetric } from "@/lib/metrics/compute";
import type { ResultMetricType } from "@/types/domain";

/** Tipo configurado -> id de métrica canônica que representa "o resultado". */
export const RESULT_METRIC_CANONICAL: Readonly<
  Record<ResultMetricType, string | null>
> = {
  leads: "leads",
  purchases: "purchases",
  // `conversations` (legado) aponta para "conversas iniciadas".
  conversations: "messaging_conversations_started",
  messaging_conversations_started: "messaging_conversations_started",
  messaging_contacts_total: "messaging_contacts_total",
  messaging_contacts_new: "messaging_contacts_new",
  registrations: "registrations",
  appointments: "appointments",
  results: null,
  custom: null,
};

export function canonicalMetricForResult(
  resultType: ResultMetricType | null | undefined,
): string | null {
  if (!resultType) return null;
  return RESULT_METRIC_CANONICAL[resultType] ?? null;
}

/** Valor de "Resultados" para o período — da métrica canônica configurada. */
export function resolveResults(
  totals: MetricTotals,
  resultType: ResultMetricType | null | undefined,
): number | null {
  const id = canonicalMetricForResult(resultType);
  return id ? computeMetric(id, totals) : null;
}

/** `cost_per_result = spend / results`, derivado em leitura. */
export function resolveCostPerResult(
  totals: MetricTotals,
  resultType: ResultMetricType | null | undefined,
): number | null {
  const results = resolveResults(totals, resultType);
  const spend = totals.spend;
  if (results === null || spend === null) return null;
  if (results === 0) return 0; // safeDivide protege; explicitamos
  return spend / results;
}

/**
 * Devolve uma cópia de `totals` com `actions.results` preenchido a partir da
 * config — para reaproveitar `computeMetric("results" | "cost_per_result")` do
 * Registry sem que o valor venha persistido do sync.
 */
export function withResolvedResults(
  totals: MetricTotals,
  resultType: ResultMetricType | null | undefined,
): MetricTotals {
  const value = resolveResults(totals, resultType);
  const actions = { ...totals.actions };
  if (value === null) delete actions.results;
  else actions.results = value;
  return { ...totals, actions };
}

/**
 * FEATURE 02A — deduplicação "Resultados"/"Custo por resultado" vs a métrica
 * CONCRETA correspondente. Quando `result_metric.type` resolve para uma
 * métrica concreta X (via `RESULT_METRIC_CANONICAL` acima) e X (ou o custo de
 * X) TAMBÉM está habilitado como card/coluna próprio, os dois mostrariam o
 * MESMO número sob rótulos diferentes (ex.: type=messaging_conversations_started
 * -> "Resultados" relabelado para "Conversas iniciadas" + card dedicado
 * "Conversas iniciadas" = duas vezes o mesmo card).
 *
 * `costMetricId` só existe quando há um `formula()` dedicado no Registry para
 * o custo daquele tipo (`cpl`, `cpa`, `cost_per_conversation`) — tipos sem
 * custo concreto próprio (contatos, cadastros, agendamentos) deduplicam só o
 * valor. `results`/`custom` não têm concreta -> sem entrada (nada a deduplicar).
 *
 * Consumido por `lib/dashboard-config.ts#dedupeResultDuplicates` — ÚNICA
 * função que decide quais cards/colunas renderizar (nada espalhado no JSX).
 */
export interface ResultDuplicate {
  /** id de métrica cujo card/coluna é idêntico ao "Resultados" quando ambos habilitados. */
  valueMetricId: string;
  /** id do custo concreto correspondente, quando existe um formula() dedicado. */
  costMetricId?: string;
}

export const RESULT_TYPE_DUPLICATE: Readonly<
  Partial<Record<ResultMetricType, ResultDuplicate>>
> = {
  leads: { valueMetricId: "leads", costMetricId: "cpl" },
  purchases: { valueMetricId: "purchases", costMetricId: "cpa" },
  // `conversations` (legado) resolve como "conversas iniciadas" — mesma dupla.
  conversations: {
    valueMetricId: "messaging_conversations_started",
    costMetricId: "cost_per_conversation",
  },
  messaging_conversations_started: {
    valueMetricId: "messaging_conversations_started",
    costMetricId: "cost_per_conversation",
  },
  messaging_contacts_total: { valueMetricId: "messaging_contacts_total" },
  messaging_contacts_new: { valueMetricId: "messaging_contacts_new" },
  registrations: { valueMetricId: "registrations" },
  appointments: { valueMetricId: "appointments" },
};

/** A dupla concreta (valor + custo) do tipo configurado, ou `null` (results/custom). */
export function resultDuplicateFor(
  resultType: ResultMetricType | null | undefined,
): ResultDuplicate | null {
  if (!resultType) return null;
  return RESULT_TYPE_DUPLICATE[resultType] ?? null;
}
