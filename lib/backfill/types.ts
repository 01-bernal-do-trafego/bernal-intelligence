/**
 * DATA V2.2.1 — Historical Backfill Control Plane. Tipos. Módulo PURO.
 *
 * Espelham os enums `meta_backfill_job_status` / `meta_backfill_segment_status`
 * de `supabase/migrations/20260910120000_meta_backfill_control_plane.sql`.
 * Nenhum consumidor real ainda (sem planner/executor nesta fase) — existem para
 * o helper de transição (`transitions.ts`) e para o código que virá em
 * DATA V2.2.2 (planner) / V2.2.3 (executor).
 *
 * Qualquer mudança aqui exige a mudança correspondente na migration (e
 * vice-versa) — os dois lugares precisam concordar.
 */

import type { EntityLevel } from "@/lib/query/types";

/** Estado de UM job de backfill (cliente + conta). */
export type BackfillJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "exhausted"
  | "failed"
  | "cancelled";

/** Estado de UM segmento (job + nível + intervalo de datas). */
export type BackfillSegmentStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped_no_data";

/**
 * Nível de um job/segmento de backfill. MESMOS 4 níveis da Query Layer
 * (V2.1) — alias deliberado, não um tipo paralelo. `creative_analysis` fica
 * fora (não é um nível de insight real; ver `lib/metrics/registry.ts`).
 */
export type BackfillLevel = EntityLevel;
