/**
 * Saúde de sincronização por cliente. Módulo PURO — espelha o cálculo da view
 * `public.meta_client_sync_health` (a view é a fonte em produção; isto testa a
 * lógica de agregação).
 *
 * TRÊS EIXOS SEPARADOS:
 *  - PERFORMANCE FRESHNESS: só a IDADE do último `performance_synced_at` válido
 *    (stages essenciais todos `done`). Uma tentativa que falhou NÃO envelhece
 *    dados válidos nem vira "failed".
 *  - LAST SYNC HEALTH: agregado do BATCH mais recente (N runs, um por conta) —
 *    não "a última conta que terminou".
 *  - CREATIVES HEALTH: agregado entre as contas do batch; independente da
 *    performance.
 */

export type PerformanceStatus = "fresh" | "stale" | "never";
export type LastSyncStatus =
  | "success"
  | "partial"
  | "failed"
  | "running"
  | "never";
export type CreativesStatus = "ok" | "partial" | "failed" | "unknown";

/** stages essenciais de PERFORMANCE (creatives/ad_creatives NÃO entram). */
export const ESSENTIAL_STAGES: readonly string[] = [
  "campaigns",
  "adsets",
  "ads",
  "insights_daily_account",
  "insights_daily_campaign",
  "insights_daily_adset",
  "insights_daily_ad",
  "insights_periodic_account",
  "insights_periodic_campaign",
  "insights_periodic_adset",
  "insights_periodic_ad",
];

export function essentialStagesComplete(stagesDone: readonly string[]): boolean {
  const set = new Set(stagesDone);
  return ESSENTIAL_STAGES.every((s) => set.has(s));
}

/**
 * `performance_synced_at` do cliente = a conta ELEGÍVEL mais atrasada.
 * Qualquer conta sem run essencial-ok (`null`) -> cliente `null` (never).
 */
export function performanceSyncedAt(
  perAccount: readonly (string | null)[],
): string | null {
  if (perAccount.length === 0) return null;
  if (perAccount.some((a) => a == null)) return null;
  return (perAccount as string[]).reduce((min, a) => (a < min ? a : min));
}

export function performanceStatus(
  syncedAt: string | null,
  now: number = Date.now(),
  freshHours = 8,
): PerformanceStatus {
  if (!syncedAt) return "never";
  const t = Date.parse(syncedAt);
  if (!Number.isFinite(t)) return "never";
  return t >= now - freshHours * 3_600_000 ? "fresh" : "stale";
}

/**
 * Status do BATCH inteiro do cliente a partir dos status das N contas:
 *   algum running -> running
 *   todos success -> success
 *   todos error   -> failed
 *   mistura       -> partial
 */
export function aggregateBatchStatus(
  statuses: readonly string[],
): LastSyncStatus {
  if (statuses.length === 0) return "never";
  if (statuses.includes("running")) return "running";
  if (statuses.every((s) => s === "success")) return "success";
  if (statuses.every((s) => s === "error")) return "failed";
  return "partial";
}

/* ---- identidade da EXECUÇÃO (batch) — inclui runs legados sem sync_batch_id */

export interface SyncRunLite {
  id: string;
  syncBatchId: string | null;
  status: string;
  startedAt: string;
}

/**
 * Chave efetiva da execução: run novo usa `sync_batch_id`; run LEGADO
 * (pré-migration) usa o próprio `id` -> vira um batch individual (não some,
 * nem funde com outros legados). Espelha `coalesce(sync_batch_id, id)` da view.
 */
export function effectiveBatchKey(r: {
  id: string;
  syncBatchId: string | null;
}): string {
  return r.syncBatchId ?? r.id;
}

/** Runs do batch (execução) MAIS RECENTE do cliente. */
export function latestBatch(runs: readonly SyncRunLite[]): SyncRunLite[] {
  if (runs.length === 0) return [];
  const newest = [...runs].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
  )[0];
  const key = effectiveBatchKey(newest);
  return runs.filter((r) => effectiveBatchKey(r) === key);
}

export interface CreativeStagePerAccount {
  /** o run tinha `stats.creatives` num formato reconhecido (objeto)? */
  present: boolean;
  upserted: number;
  minimalOnly: number;
  failed: number;
  degraded: boolean;
}

/**
 * Agrega o creatives health entre as contas do batch — baseado na SAÚDE da
 * etapa, NÃO na quantidade de inserts (em steady-state incremental o normal é
 * `upserted = 0` com tudo `known_skipped`, e isso é `ok`).
 *
 *   unknown  -> nenhuma conta tem `stats.creatives` reconhecido
 *   failed   -> há falha E nenhuma conta salvou nada (falha completa)
 *   partial  -> alguma conta com failed>0 / minimal_only>0 / degraded
 *   ok       -> stats existe e NENHUMA conta tem failed/minimal_only/degraded
 *               (independe de `upserted`)
 */
export function aggregateCreativesStatus(
  per: readonly CreativeStagePerAccount[],
): CreativesStatus {
  const present = per.filter((p) => p.present);
  if (present.length === 0) return "unknown";
  const anyIssue = present.some(
    (p) => p.failed > 0 || p.minimalOnly > 0 || p.degraded,
  );
  if (anyIssue) {
    const nothingSaved = present.every((p) => p.upserted === 0);
    const anyHardFail = present.some((p) => p.upserted === 0 && p.failed > 0);
    return nothingSaved && anyHardFail ? "failed" : "partial";
  }
  return "ok";
}
