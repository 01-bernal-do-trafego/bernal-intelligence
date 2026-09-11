/**
 * DATA V2.3A — Historical Backfill Rollout. Loop de execução do runner.
 * Módulo PURO — toda operação com efeito colateral (status, executor, sleep,
 * log) é INJETADA via `RunLoopDeps`. Nenhuma chamada de rede/Meta/Supabase
 * aqui — só a decisão de "o que fazer a seguir".
 *
 * FLUXO (por iteração):
 *   1. consulta status
 *   2. job paused -> para (não é terminal, mas o runner não espera
 *      indefinidamente por uma pausa manual — reporta e sai)
 *   3. job terminal (completed/exhausted/cancelled/failed) -> para
 *   4. existe segmento failed -> para e reporta (comportamento CONSERVADOR
 *      inicial: não tenta calcular next_retry_at nem esperar — "não
 *      esconder erro" vale mais que continuar tentando às cegas; um
 *      scheduler de retry fica para uma fase futura)
 *   5. se houver trabalho disponível (pending>0 ou running>0), chama o
 *      executor EXATAMENTE 1 vez (nunca mais de 1 unidade por iteração)
 *   6. `idle` (do executor OU nenhum trabalho disponível) incrementa o
 *      contador de idle consecutivo; qualquer resultado REAL (completed/
 *      skipped_no_data/failed/refused) zera o contador
 *   7. contador de idle atinge o limite -> para (guarda defensiva, nunca
 *      loop infinito)
 *   8. consulta status de novo (progresso fresco para log), aguarda o
 *      delay configurado, repete
 */

export interface StatusSnapshot {
  jobStatus: string;
  pending: number;
  running: number;
  failed: number;
}

export interface ExecutorInvocationResult {
  status: string; // "idle" | "done" | "skipped_no_data" | "failed" | "refused" | ...
}

export interface RunLoopDeps {
  getStatus: () => Promise<StatusSnapshot>;
  invokeExecutor: () => Promise<ExecutorInvocationResult>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface RunLoopOptions {
  delayMs: number;
  maxConsecutiveIdle: number;
}

/** Default conservador — backfill é a prioridade mais baixa do sistema (mesmo espírito de lib/backfill/rate-limit.ts). */
export const DEFAULT_DELAY_MS = 3000;
/** Guarda defensiva — nunca loop infinito. */
export const DEFAULT_MAX_CONSECUTIVE_IDLE = 10;

const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "exhausted", "cancelled", "failed"]);

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export type RunLoopOutcome =
  | { kind: "terminal"; finalStatus: string }
  | { kind: "paused" }
  | { kind: "idle_guard_triggered"; consecutiveIdle: number }
  | { kind: "failed_segment_stopped"; failedCount: number };

/**
 * Roda o loop até um desfecho terminal/guarda de segurança. NUNCA chama o
 * executor mais de 1 vez por iteração; NUNCA continua indefinidamente sem
 * progresso (guarda de idle consecutivo).
 */
export async function runBackfillLoop(deps: RunLoopDeps, opts: RunLoopOptions): Promise<RunLoopOutcome> {
  let consecutiveIdle = 0;

  for (;;) {
    const status1 = await deps.getStatus();

    if (status1.jobStatus === "paused") {
      return { kind: "paused" };
    }
    if (isTerminalJobStatus(status1.jobStatus)) {
      return { kind: "terminal", finalStatus: status1.jobStatus };
    }
    if (status1.failed > 0) {
      return { kind: "failed_segment_stopped", failedCount: status1.failed };
    }

    const hasAvailableWork = status1.pending > 0 || status1.running > 0;
    if (hasAvailableWork) {
      const execResult = await deps.invokeExecutor();
      if (execResult.status === "idle") {
        consecutiveIdle += 1;
      } else {
        consecutiveIdle = 0;
      }
    } else {
      // nada pendente/rodando, mas o job ainda não é terminal (ex.: auto-complete
      // ainda não refletiu) — trata como idle também, sem chamar o executor à toa.
      consecutiveIdle += 1;
    }

    if (consecutiveIdle >= opts.maxConsecutiveIdle) {
      return { kind: "idle_guard_triggered", consecutiveIdle };
    }

    const status2 = await deps.getStatus();
    deps.log(
      `status: job=${status2.jobStatus} pending=${status2.pending} running=${status2.running} failed=${status2.failed} idle_consecutivo=${consecutiveIdle}`,
    );

    await deps.sleep(opts.delayMs);
  }
}
