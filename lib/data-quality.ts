/**
 * DATA FOUNDATION V2 — DataQuality contract. Módulo PURO.
 *
 * Um contrato ÚNICO para "quão confiável é este número", consumível por
 * dashboard, alertas e Intelligence. Centraliza (gradualmente) sinais que hoje
 * vivem dispersos: cobertura temporal (`lib/meta/daily-coverage.ts`), freshness
 * e status de sync (`meta_client_sync_health` / `lib/meta/sync-health.ts`).
 *
 * REGRAS DESTA FASE (DATA V2.0):
 *  - o TIPO suporta todos os estados previstos na arquitetura;
 *  - `getDataQuality()` só PRODUZ estados com evidência real hoje:
 *      ok · partial · stale · no_data
 *  - NUNCA infere `no_delivery` a partir de `no_data`;
 *  - NUNCA infere `tracking_suspect` / `not_consolidable` / etc. sem sinal
 *    concreto — nenhum produtor deles nesta fase;
 *  - ausência de linha NÃO vira zero (`resolveValuePresence`).
 *
 * NÃO é ligado ao `real-dashboard.ts` nesta fase — camada paralela, testada.
 * Só será integrada quando houver paridade 1:1 comprovada.
 */

import type { Coverage } from "@/lib/meta/daily-coverage";
import type { PerformanceStatus, LastSyncStatus } from "@/lib/meta/sync-health";

/**
 * Estados possíveis. Só os de `PRODUCED_DATA_QUALITY_STATES` têm produtor real
 * nesta fase; o resto é contrato preparado para blocos futuros.
 */
export type DataQualityState =
  | "ok"
  | "real_zero"
  | "no_data"
  | "no_delivery"
  | "partial"
  | "stale"
  | "rate_limited"
  | "metric_not_available_in_period"
  | "not_consolidable"
  | "unconfirmed"
  | "insufficient_sample"
  | "tracking_suspect"
  | "backfill_incomplete";

/** Estados que `getDataQuality()` pode devolver HOJE (têm evidência V1). */
export const PRODUCED_DATA_QUALITY_STATES: readonly DataQualityState[] = [
  "ok",
  "partial",
  "stale",
  "no_data",
];

/** Estados apenas PREPARADOS — sem produtor nesta fase. */
export const FUTURE_DATA_QUALITY_STATES: readonly DataQualityState[] = [
  "real_zero",
  "no_delivery",
  "rate_limited",
  "metric_not_available_in_period",
  "not_consolidable",
  "unconfirmed",
  "insufficient_sample",
  "tracking_suspect",
  "backfill_incomplete",
];

export type DataQualityConfidence = "high" | "medium" | "low";

export interface DataQuality {
  state: DataQualityState;
  confidence: DataQualityConfidence;
  coverage: {
    expectedDays: number;
    presentDays: number;
    missingDates: readonly string[];
  };
  freshness: {
    lastSyncAt: string | null;
    ageHours: number | null;
    targetHours: number;
  };
  /** Motivos legíveis por máquina (para alertas/Intelligence filtrarem). */
  reasons: readonly string[];
  /** Frase curta PT-BR, pronta para a UI. */
  humanNote: string;
}

const DEFAULT_TARGET_HOURS = 8; // igual a `performanceStatus` freshHours

export interface DataQualityInput {
  /** Cobertura do intervalo pedido (de `rangeCoverage`). */
  coverage?: Coverage | null;
  /** Sinais do `meta_client_sync_health` já lidos. */
  health?: {
    performanceStatus: PerformanceStatus;
    lastSyncStatus?: LastSyncStatus;
    lastSyncAt?: string | null;
    performanceSyncedAt?: string | null;
  } | null;
  /** O chamador tem PELO MENOS uma linha (diária ou periódica) para a entidade+intervalo? */
  hasRows: boolean;
  /** Alvo de freshness em horas (default 8). */
  targetHours?: number;
  now?: number;
}

function ageHoursOf(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
}

const NOTE: Record<DataQualityState, string> = {
  ok: "Dados completos e atualizados no período.",
  real_zero: "Sem resultados no período (zero real).",
  no_data: "Sem dados para este período.",
  no_delivery: "Sem veiculação no período.",
  partial: "Período com dias sem dados no histórico diário.",
  stale: "Dados podem estar desatualizados — última sincronização antiga.",
  rate_limited: "A Meta limitou as requisições — dados podem estar defasados.",
  metric_not_available_in_period: "Esta métrica não está disponível neste período.",
  not_consolidable: "Não é possível consolidar esta métrica neste recorte.",
  unconfirmed: "Atribuição ainda não confirmada (histórico curto).",
  insufficient_sample: "Amostra insuficiente para uma conclusão.",
  tracking_suspect: "Rastreamento inconsistente — verifique o pixel/eventos.",
  backfill_incomplete: "Histórico ainda sendo preenchido para este período.",
};

/**
 * Produz o contrato a partir de evidência V1. Só devolve
 * `ok | partial | stale | no_data`.
 */
export function getDataQuality(input: DataQualityInput): DataQuality {
  const now = input.now ?? Date.now();
  const targetHours = input.targetHours ?? DEFAULT_TARGET_HOURS;
  const cov = input.coverage ?? null;

  const expectedDays = cov?.requiredDates.length ?? 0;
  const missingDates = cov?.missingDates ?? [];
  const presentDays = Math.max(0, expectedDays - missingDates.length);

  const lastSyncAt =
    input.health?.performanceSyncedAt ?? input.health?.lastSyncAt ?? null;
  const freshness = {
    lastSyncAt,
    ageHours: ageHoursOf(lastSyncAt, now),
    targetHours,
  };
  const coverage = { expectedDays, presentDays, missingDates };

  const reasons: string[] = [];
  let state: DataQualityState;
  let confidence: DataQualityConfidence;

  const perf = input.health?.performanceStatus;
  const isStale = perf === "stale";
  const syncIncomplete = perf === "never" || perf === undefined;

  if (!input.hasRows || cov?.status === "empty") {
    state = "no_data";
    confidence = "high";
    reasons.push("no_rows");
  } else if (cov?.status === "partial") {
    state = "partial";
    confidence = "medium";
    reasons.push("coverage_partial", `missing_days:${missingDates.length}`);
    if (isStale) reasons.push("freshness_stale");
  } else if (isStale) {
    state = "stale";
    confidence = "medium";
    reasons.push("freshness_stale");
  } else if (syncIncomplete && input.health != null) {
    // linhas existem mas nenhum sync essencial-completo -> não afirmamos "ok"
    state = "stale";
    confidence = "medium";
    reasons.push("sync_incomplete");
  } else {
    state = "ok";
    confidence = "high";
  }

  return {
    state,
    confidence,
    coverage,
    freshness,
    reasons,
    humanNote: NOTE[state],
  };
}

/** Contrato neutro (sem informação). */
export function emptyDataQuality(): DataQuality {
  return {
    state: "no_data",
    confidence: "high",
    coverage: { expectedDays: 0, presentDays: 0, missingDates: [] },
    freshness: { lastSyncAt: null, ageHours: null, targetHours: DEFAULT_TARGET_HOURS },
    reasons: ["no_rows"],
    humanNote: NOTE.no_data,
  };
}

export type ValuePresence = "value" | "real_zero" | "no_data" | "missing";

/**
 * Distingue ZERO REAL de AUSÊNCIA — regra "no data ≠ zero" formalizada.
 *   - `value == null`  → `no_data` (se o contrato diz no_data) ou `missing`
 *   - `value === 0`    → `real_zero` (se há dado) ou `no_data`
 *   - caso contrário   → `value`
 * NÃO transforma ausência em zero, nem zero em ausência.
 */
export function resolveValuePresence(args: {
  value: number | null | undefined;
  dataQuality: Pick<DataQuality, "state">;
}): ValuePresence {
  const noData = args.dataQuality.state === "no_data";
  if (args.value === null || args.value === undefined) {
    return noData ? "no_data" : "missing";
  }
  if (args.value === 0) {
    return noData ? "no_data" : "real_zero";
  }
  return "value";
}
