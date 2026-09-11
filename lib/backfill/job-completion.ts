/**
 * DATA V2.2.4 — Automatic Job Finalization. Módulo PURO.
 *
 * Espelha EXATAMENTE a condição SQL do `UPDATE public.meta_backfill_jobs`
 * dentro de `complete_backfill_segment`
 * (`supabase/migrations/20260911171000_meta_backfill_auto_complete_job.sql`):
 *
 *   j.status = 'running'
 *   AND EXISTS (>= 1 segmento do job)
 *   AND NOT EXISTS (segmento pending/running/failed do job)
 *
 * Existe para tornar essa regra TESTÁVEL de verdade em Vitest (a migration
 * não está aplicada — não há banco para exercitar o SQL ao vivo). Mantenha
 * os dois em sync se um mudar — guardado por parse-guard em
 * `tests/backfill/auto-complete-job.guard.test.ts`.
 */
import type { BackfillJobStatus, BackfillSegmentStatus } from "./types";

/** Estados de SEGMENTO que impedem a auto-finalização do job (não-terminais para este propósito). */
const BLOCKING_SEGMENT_STATUSES: readonly BackfillSegmentStatus[] = ["pending", "running", "failed"];

/**
 * `true` quando o job deve virar `completed` AGORA, dado seu status atual e
 * os status de TODOS os segmentos que já existem para ele. Puro — não olha
 * banco, não olha lease/fencing (isso já aconteceu antes, no UPDATE fenced
 * do segmento — esta função só é "chamada" depois de um `complete` que
 * realmente aconteceu).
 *
 * NUNCA devolve true para `exhausted` — a função só devolve um boolean de
 * "deve completar", nunca escolhe `exhausted` (essa categoria não é decidida
 * por esta regra, é reservada ao discovery futuro).
 */
export function shouldAutoCompleteJob(
  jobStatus: BackfillJobStatus,
  segmentStatuses: readonly BackfillSegmentStatus[],
): boolean {
  if (jobStatus !== "running") return false;
  if (segmentStatuses.length === 0) return false;
  return segmentStatuses.every((s) => !BLOCKING_SEGMENT_STATUSES.includes(s));
}
