/**
 * DATA V2.2.1 — Historical Backfill Control Plane. Transições de status.
 * Módulo PURO.
 *
 * ESPELHA EXATAMENTE as triggers `meta_backfill_jobs_check_transition()` e
 * `meta_backfill_segments_check_transition()` de
 * `supabase/migrations/20260910120000_meta_backfill_control_plane.sql`. Uma
 * mudança aqui SEM a mudança correspondente na migration (ou vice-versa) quebra
 * a garantia de "o banco nunca aceita uma transição que o app julga inválida" —
 * `tests/backfill/*-migration.test.ts` faz a checagem cruzada.
 *
 * Sem consumidor real nesta fase (sem planner/executor) — usado hoje só pelos
 * testes; a base para o dispatcher/executor de DATA V2.2.2+.
 */
import type { BackfillJobStatus, BackfillSegmentStatus } from "./types";

/** pending -> running, cancelled · running -> paused, completed, exhausted, failed, cancelled · paused -> running, cancelled · demais: terminais. */
const JOB_TRANSITIONS: Readonly<Record<BackfillJobStatus, ReadonlySet<BackfillJobStatus>>> = {
  pending: new Set(["running", "cancelled"]),
  running: new Set(["paused", "completed", "exhausted", "failed", "cancelled"]),
  paused: new Set(["running", "cancelled"]),
  completed: new Set(),
  exhausted: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

/** pending -> running · running -> done, failed, skipped_no_data, pending (lease) · failed -> pending (retry) · demais: terminais. */
const SEGMENT_TRANSITIONS: Readonly<Record<BackfillSegmentStatus, ReadonlySet<BackfillSegmentStatus>>> = {
  pending: new Set(["running"]),
  running: new Set(["done", "failed", "skipped_no_data", "pending"]),
  failed: new Set(["pending"]),
  done: new Set(),
  skipped_no_data: new Set(),
};

/** `true` se `status` não tem nenhuma transição de saída (estado final). */
export function isTerminalJobStatus(status: BackfillJobStatus): boolean {
  return JOB_TRANSITIONS[status].size === 0;
}

/**
 * `true` se `from -> to` é uma transição válida do JOB. Mesmo status
 * (`from === to`) é sempre válido — é um update que não muda o status (ex.:
 * só atualizando `last_error_code`).
 */
export function isValidJobTransition(
  from: BackfillJobStatus,
  to: BackfillJobStatus,
): boolean {
  if (from === to) return true;
  return JOB_TRANSITIONS[from].has(to);
}

/**
 * `true` quando um job NESTE status pode fornecer segmento em
 * `claim_next_backfill_segment` — espelha o `where j.status = 'running'` do
 * RPC. Um job `paused`/`pending`/terminal nunca fornece segmento.
 */
export function canJobProvideSegments(status: BackfillJobStatus): boolean {
  return status === "running";
}

/** `true` se `status` não tem nenhuma transição de saída (estado final). */
export function isTerminalSegmentStatus(status: BackfillSegmentStatus): boolean {
  return SEGMENT_TRANSITIONS[status].size === 0;
}

/** `true` se `from -> to` é uma transição válida do SEGMENTO. Mesma regra de auto-transição do job. */
export function isValidSegmentTransition(
  from: BackfillSegmentStatus,
  to: BackfillSegmentStatus,
): boolean {
  if (from === to) return true;
  return SEGMENT_TRANSITIONS[from].has(to);
}

/**
 * `true` quando um segmento NESTE status pode ser reivindicado por
 * `claim_next_backfill_segment` — espelha o `s2.status = 'pending'` do RPC.
 * `failed` NUNCA é reivindicado diretamente: o retry é `failed -> pending`
 * primeiro (decisão separada, futura), só depois elegível ao claim.
 */
export function isClaimableSegmentStatus(status: BackfillSegmentStatus): boolean {
  return status === "pending";
}
