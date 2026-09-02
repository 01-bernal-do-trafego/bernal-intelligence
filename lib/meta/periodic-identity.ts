/**
 * Identidade dos agregados de período (`meta_insights_periodic`). Módulo PURO.
 *
 * A unicidade REAL de um agregado é o INTERVALO, não o preset:
 *
 *     level · entity_id · date_from · date_to · attribution_window
 *
 * `period_key` (last_30d | last_7d | this_month | custom | ...) é só um RÓTULO
 * — útil para achar "o último last_30d", mas NÃO define unicidade. Assim:
 *   - o mesmo intervalo sincronizado de novo ATUALIZA a linha (não duplica);
 *   - `last_30d` calculado em datas diferentes gera intervalos diferentes ->
 *     linhas distintas que CONVIVEM;
 *   - o período anterior continua disponível após uma nova sincronização;
 *   - períodos personalizados diferentes coexistem.
 *
 * Vale especialmente para `reach`/`frequency`: cada intervalo guarda o valor
 * agregado que a própria Meta retornou PARA AQUELE INTERVALO. Nunca se deriva
 * reach histórico somando reach diário.
 *
 * Este módulo modela — para os testes — o comportamento do
 * `on conflict (level, entity_id, date_from, date_to, attribution_window)` da
 * RPC `meta_upsert_insights_periodic`. A aplicação real é o índice único
 * `meta_insights_periodic_interval_uq`.
 */

export const DEFAULT_ATTRIBUTION_WINDOW = "unified_attribution";

export interface PeriodicRowLike {
  level: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
  attributionWindow?: string;
  /** rótulo — não entra na identidade. */
  periodKey?: string;
  reach?: number | null;
  frequency?: number | null;
  [extra: string]: unknown;
}

/** Chave de identidade de um agregado — o intervalo. */
export function periodicIntervalKey(row: PeriodicRowLike): string {
  return [
    row.level,
    row.entityId,
    row.dateFrom,
    row.dateTo,
    row.attributionWindow ?? DEFAULT_ATTRIBUTION_WINDOW,
  ].join("|");
}

/** `true` se as duas linhas descrevem o MESMO agregado (mesmo intervalo). */
export function sameInterval(a: PeriodicRowLike, b: PeriodicRowLike): boolean {
  return periodicIntervalKey(a) === periodicIntervalKey(b);
}

/**
 * Modela o upsert: cada linha de `incoming` substitui a de `existing` com a
 * MESMA identidade de intervalo; as demais permanecem. Ordem estável
 * (existentes primeiro, na ordem original; novos intervalos ao final).
 */
export function upsertPeriodicRows<T extends PeriodicRowLike>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const order: string[] = [];
  const byKey = new Map<string, T>();

  for (const row of existing) {
    const key = periodicIntervalKey(row);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, row);
  }
  for (const row of incoming) {
    const key = periodicIntervalKey(row);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, row); // substitui a mesma identidade
  }

  return order.map((key) => byKey.get(key)!);
}

/**
 * Entre várias linhas do mesmo preset/entidade, a "corrente" é a do intervalo
 * com `date_to` mais recente (empate: `date_from` mais recente). Não soma nada.
 */
export function latestForPreset<T extends PeriodicRowLike>(
  rows: readonly T[],
  opts: { level: string; entityId: string; periodKey: string },
): T | null {
  const candidates = rows.filter(
    (r) =>
      r.level === opts.level &&
      r.entityId === opts.entityId &&
      (r.periodKey ?? "custom") === opts.periodKey,
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) =>
    a.dateTo === b.dateTo
      ? b.dateFrom.localeCompare(a.dateFrom)
      : b.dateTo.localeCompare(a.dateTo),
  )[0];
}
