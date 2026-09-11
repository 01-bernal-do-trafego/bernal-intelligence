/**
 * DATA V2.2.3 — Real Backfill Executor. Classificação de erro / retry.
 * Módulo PURO.
 *
 * REUTILIZA o VOCABULÁRIO já classificado por
 * `supabase/functions/_shared/graph.ts#classifyGraphError` — este módulo NÃO
 * reclassifica nada a partir do código/corpo bruto da resposta Meta (isso
 * duplicaria heurística, proibido nesta etapa). `BackfillErrorKind` é o
 * MESMO union de `GraphErrorKind` (graph.ts) — mantenha os dois em sync se
 * um mudar. O adapter real (Edge Function, Deno) é quem chama
 * `classifyGraphError` de verdade e repassa o resultado aqui.
 *
 * O que ESTE módulo decide (não existe em graph.ts, é específico de
 * backfill/segmento):
 *   - backoff (next_retry_at) por categoria — conservador, backfill é a
 *     prioridade mais baixa do sistema (mesmo espírito de
 *     `lib/backfill/rate-limit.ts`);
 *   - se deve marcar a conexão como `reauthorization_required` — MESMA regra
 *     que `sync-core.ts` já aplica: só `token_revoked` (nunca
 *     `insufficient_permission`, nunca `rate_limited`/`transient`/`unknown`).
 *
 * SEGMENT `failed` é sempre retryable (V2.2.1/V2.2.2) — não existe uma
 * categoria "terminal" própria de segmento; quem efetivamente para de tentar
 * é o `next_retry_at` (crescente) combinado com decisão operacional futura,
 * não uma classificação aqui.
 */

export type BackfillErrorKind =
  | "token_revoked"
  | "insufficient_permission"
  | "rate_limited"
  | "transient"
  | "unknown";

/** Minutos de espera antes do próximo retry elegível, por categoria. */
export const DEFAULT_BACKOFF_MINUTES: Readonly<Record<BackfillErrorKind, number>> = {
  rate_limited: 30, // pressão de rate limit -> espera mais
  transient: 5, // falha passageira -> espera pouco
  unknown: 15, // categoria não reconhecida -> conservador, meio-termo
  token_revoked: 60, // exige reautorização humana -> não adianta tentar de novo rápido
  insufficient_permission: 60, // idem — não é algo que se resolve sozinho
};

export function computeNextRetryAt(
  kind: BackfillErrorKind,
  now: Date = new Date(),
  policy: Readonly<Record<BackfillErrorKind, number>> = DEFAULT_BACKOFF_MINUTES,
): string {
  const minutes = policy[kind];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * MESMA regra de `sync-core.ts` (`fatal === "token_revoked"` ->
 * `meta_connections.status = 'reauthorization_required'`) — só
 * `token_revoked`. `insufficient_permission` NÃO marca a conexão (permissão
 * insuficiente não é necessariamente "token morto"; Current Sync também não
 * trata os dois iguais).
 */
export function shouldMarkReauthRequired(kind: BackfillErrorKind): boolean {
  return kind === "token_revoked";
}
