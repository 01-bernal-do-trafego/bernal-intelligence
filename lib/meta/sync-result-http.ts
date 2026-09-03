/**
 * Tradução do resultado de `runClientSync` (núcleo compartilhado) para HTTP, nos
 * dois entrypoints. Módulo PURO — os arquivos Deno (`meta-sync/index.ts`,
 * `meta-sync-scheduled/index.ts`, `_shared/sync-core.ts`) espelham esta lógica.
 *
 * Distinção central:
 *  - SKIP ESPERADO (`sync_already_running`, `no_eligible_account`): estado
 *    normal, não é falha.
 *  - ERRO INESPERADO (qualquer outra falha de acquire): NÃO pode virar skip.
 *    Scheduled -> 5xx; manual -> erro real ao frontend. Payload SANITIZADO
 *    (nunca SQL bruto / token / dados): só `reason`, `phase` e, se houver,
 *    `code` = SQLSTATE de 5 caracteres.
 */

export interface RunClientSyncResultLike {
  ok: boolean;
  reason?: string;
  /** true = skip esperado; false/undefined num resultado !ok = erro inesperado. */
  skip?: boolean;
  phase?: string;
  code?: string;
}

/** erro cru do PostgREST/supabase-js na chamada da RPC de acquire. */
export interface AcquireErrorLike {
  message?: unknown;
  code?: unknown;
}

const SQLSTATE_RE = /^[0-9A-Za-z]{5}$/;

/**
 * Classifica a falha do acquire. NUNCA propaga `message`/`details`/`hint`
 * (podem carregar SQL ou dados) — só o SQLSTATE, quando existir.
 */
export function classifyAcquireError(err: AcquireErrorLike): {
  reason: string;
  skip: boolean;
  phase?: string;
  code?: string;
} {
  const msg = typeof err?.message === "string" ? err.message : String(err?.message ?? "");
  if (msg.includes("sync_already_running")) {
    return { reason: "sync_already_running", skip: true };
  }
  if (msg.includes("no_eligible_account")) {
    return { reason: "no_eligible_account", skip: true };
  }
  const rawCode = err?.code;
  const code = typeof rawCode === "string" && SQLSTATE_RE.test(rawCode) ? rawCode : undefined;
  return { reason: "acquire_failed", skip: false, phase: "acquire", ...(code ? { code } : {}) };
}

export interface HttpShape {
  status: number;
  body: Record<string, unknown>;
}

/** Resposta do entrypoint SCHEDULED (`meta-sync-scheduled`). */
export function scheduledHttpForResult(r: RunClientSyncResultLike): HttpShape {
  if (r.ok) return { status: 200, body: { status: "ok" } };
  if (r.skip) {
    return { status: 200, body: { status: "skipped", reason: r.reason ?? "unknown" } };
  }
  return {
    status: 500,
    body: {
      status: "error",
      reason: r.reason ?? "acquire_failed",
      ...(r.phase ? { phase: r.phase } : {}),
      ...(r.code ? { code: r.code } : {}),
    },
  };
}

/** Resposta do entrypoint MANUAL (`meta-sync`). */
export function manualHttpForResult(r: RunClientSyncResultLike): HttpShape {
  if (r.ok) return { status: 200, body: {} };
  if (r.skip) {
    // conflito de estado real, mostrado ao usuário (não é 200/skipped).
    return { status: 409, body: { error: r.reason ?? "sync_conflict" } };
  }
  return {
    status: 500,
    body: {
      error: r.reason ?? "acquire_failed",
      ...(r.phase ? { phase: r.phase } : {}),
      ...(r.code ? { code: r.code } : {}),
    },
  };
}
