/**
 * Regra "cliente está DUE para sync automática" — módulo PURO que espelha
 * `public.meta_clients_due_for_sync(...)` (a função SQL é a fonte em produção;
 * isto documenta e testa a lógica de seleção do dispatcher).
 *
 * Três condições, todas obrigatórias:
 *  1. NÃO há sync `running` recente (< 20 min) para o cliente.
 *  2. Performance está velha: `performance_synced_at` é null OU mais antigo que
 *     `minAge` (default 4h). Uma tentativa que falhou NÃO mexe nesse timestamp.
 *  3. COOLDOWN: NÃO houve nenhuma tentativa (qualquer status, manual ou cron)
 *     iniciada dentro de `retryCooldown` (default 4h). Isso impede o dispatcher
 *     de re-disparar a cada 15 min depois de uma falha.
 *
 * O caminho MANUAL não passa por aqui — o usuário pode sincronizar antes do
 * cooldown.
 */

const HOUR_MS = 3_600_000;

export interface DueForSyncInput {
  /** timestamp ISO do último `performance_synced_at` válido do cliente, ou null. */
  performanceSyncedAt: string | null;
  /**
   * timestamp ISO do `started_at` mais recente de QUALQUER meta_sync_runs do
   * cliente (sucesso, parcial, erro ou running; manual ou cron), ou null se
   * nunca houve run.
   */
  lastAttemptStartedAt: string | null;
  /** existe run `running` do cliente iniciado há menos de 20 min? */
  hasRecentRunningRun: boolean;
  /** agora (ms epoch). default: Date.now(). */
  now?: number;
  /** alvo de frescor por cliente. default 4h. */
  minAgeMs?: number;
  /** cooldown de retry após uma tentativa. default 4h. */
  retryCooldownMs?: number;
}

export function isClientDueForSync(input: DueForSyncInput): boolean {
  const now = input.now ?? Date.now();
  const minAge = input.minAgeMs ?? 4 * HOUR_MS;
  const cooldown = input.retryCooldownMs ?? 4 * HOUR_MS;

  // 1. sync em andamento -> não seleciona
  if (input.hasRecentRunningRun) return false;

  // 2. performance precisa estar velha
  const perf = input.performanceSyncedAt;
  const stale =
    perf === null ||
    !Number.isFinite(Date.parse(perf)) ||
    Date.parse(perf) < now - minAge;
  if (!stale) return false;

  // 3. cooldown: tentativa recente (qualquer status) bloqueia re-seleção
  const last = input.lastAttemptStartedAt;
  if (last !== null && Number.isFinite(Date.parse(last)) && Date.parse(last) > now - cooldown) {
    return false;
  }

  return true;
}
