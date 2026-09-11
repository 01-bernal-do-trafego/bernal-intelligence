/**
 * DATA V2.2.2 — Historical Backfill. Executor FOUNDATION. Módulo PURO.
 *
 * Contrato/orquestração de UM segmento — `executeBackfillSegment(task, deps)`.
 * TODA operação com efeito colateral (checar conta linkada, checar rate
 * budget, buscar da Meta, normalizar/upsert, finalizar com fencing) é
 * INJETADA via `BackfillExecutorDeps` — nenhuma implementação real existe
 * neste módulo. Em particular, `fetchInsights` é só um TIPO: não há adapter
 * real de Meta aqui, então esta fase estruturalmente NÃO PODE fazer uma
 * chamada de rede — só um teste com um fake/mock pode "rodar" isto.
 *
 * A função em si é pura o bastante para testar sem I/O: dado um `deps` fake,
 * o comportamento é 100% determinístico.
 *
 * Responsabilidades futuras (DATA V2.2.3+, adapter real):
 *   - implementar `isAccountLinked`/`canRunBackfill`/`fetchInsights`/
 *     `upsertDaily` de verdade (Supabase + Meta Graph API);
 *   - implementar `completeSegment`/`failSegment` chamando as RPCs
 *     `complete_backfill_segment`/`fail_backfill_segment` (DATA V2.2.2, já
 *     existem no schema, não aplicadas ainda).
 */
import type { BackfillLevel } from "./types";
import type { NormalizedDailyRow } from "@/lib/query/types";

export interface BackfillSegmentTask {
  id: string;
  jobId: string;
  clientId: string;
  /** uuid interno (meta_ad_accounts.id) — usado para checar is_linked/rate budget. */
  adAccountRef: string;
  /** id Meta (ex.: "act_123") — usado para a chamada de fetch. */
  adAccountId: string;
  level: BackfillLevel;
  dateFrom: string;
  dateTo: string;
  /** Token de posse desta reivindicação (claim_next_backfill_segment) — obrigatório para finalizar. */
  leaseToken: string;
}

export interface FetchInsightsArgs {
  adAccountId: string;
  level: BackfillLevel;
  dateFrom: string;
  dateTo: string;
}

export interface FetchInsightsResult {
  rows: readonly NormalizedDailyRow[];
  pages: number;
}

export interface CompleteSegmentArgs {
  segmentId: string;
  leaseToken: string;
  rowsWritten: number;
  pagesFetched: number;
  outcome: "done" | "skipped_no_data";
}

export interface FailSegmentArgs {
  segmentId: string;
  leaseToken: string;
  errorCode: string;
}

/**
 * Portas injetadas — cada uma corresponde a uma responsabilidade futura do
 * executor real. Nenhuma tem implementação aqui.
 */
export interface BackfillExecutorDeps {
  /** DATA V2.2.2: reflete `meta_ad_accounts.is_linked` — recusa antes de gastar rate budget/chamar a Meta. */
  isAccountLinked: (adAccountRef: string) => Promise<boolean>;
  /** `lib/backfill/rate-limit.ts#canRunBackfill` por trás — decide se HÁ folga para rodar agora. */
  canRunBackfill: (adAccountRef: string) => Promise<boolean>;
  /** NÃO implementado nesta fase — nenhuma chamada real à Meta existe no repositório. */
  fetchInsights: (args: FetchInsightsArgs) => Promise<FetchInsightsResult>;
  /** Upsert em `meta_insights_daily` — mesmo destino do Current Sync, adapter real futuro. */
  upsertDaily: (rows: readonly NormalizedDailyRow[]) => Promise<{ rowsWritten: number }>;
  /** RPC `complete_backfill_segment` (fencing) — `false` = posse perdida. */
  completeSegment: (args: CompleteSegmentArgs) => Promise<boolean>;
  /** RPC `fail_backfill_segment` (fencing) — `false` = posse perdida. */
  failSegment: (args: FailSegmentArgs) => Promise<boolean>;
}

export type ExecuteSegmentOutcome =
  | { kind: "completed"; rowsWritten: number }
  | { kind: "skipped_no_data" }
  | { kind: "failed"; reason: string }
  | { kind: "refused"; reason: "not_linked" | "rate_limited" | "ownership_lost" };

/**
 * Orquestra UM segmento. Ordem: conta linkada -> rate budget -> fetch ->
 * (vazio -> skipped_no_data | com linhas -> upsert -> done) -> finaliza com
 * fencing. Qualquer `completeSegment`/`failSegment` retornando `false` vira
 * `{kind:"refused", reason:"ownership_lost"}` — nunca é tratado como sucesso
 * silencioso nem re-tentado com o MESMO `leaseToken`.
 */
export async function executeBackfillSegment(
  task: BackfillSegmentTask,
  deps: BackfillExecutorDeps,
): Promise<ExecuteSegmentOutcome> {
  if (!(await deps.isAccountLinked(task.adAccountRef))) {
    return { kind: "refused", reason: "not_linked" };
  }
  if (!(await deps.canRunBackfill(task.adAccountRef))) {
    return { kind: "refused", reason: "rate_limited" };
  }

  let fetched: FetchInsightsResult;
  try {
    fetched = await deps.fetchInsights({
      adAccountId: task.adAccountId,
      level: task.level,
      dateFrom: task.dateFrom,
      dateTo: task.dateTo,
    });
  } catch (err) {
    const errorCode = err instanceof Error ? err.message.slice(0, 200) : "unknown_error";
    const ok = await deps.failSegment({
      segmentId: task.id,
      leaseToken: task.leaseToken,
      errorCode,
    });
    return ok ? { kind: "failed", reason: errorCode } : { kind: "refused", reason: "ownership_lost" };
  }

  if (fetched.rows.length === 0) {
    const ok = await deps.completeSegment({
      segmentId: task.id,
      leaseToken: task.leaseToken,
      rowsWritten: 0,
      pagesFetched: fetched.pages,
      outcome: "skipped_no_data",
    });
    return ok ? { kind: "skipped_no_data" } : { kind: "refused", reason: "ownership_lost" };
  }

  const { rowsWritten } = await deps.upsertDaily(fetched.rows);
  const ok = await deps.completeSegment({
    segmentId: task.id,
    leaseToken: task.leaseToken,
    rowsWritten,
    pagesFetched: fetched.pages,
    outcome: "done",
  });
  return ok ? { kind: "completed", rowsWritten } : { kind: "refused", reason: "ownership_lost" };
}
