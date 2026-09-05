/**
 * Seleção da linha AUTORITATIVA de `meta_insights_periodic` para um período.
 * Módulo PURO — compartilhado entre a Agency Overview e o dashboard individual
 * para que a regra seja UMA só.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * `period_key` (`last_30d`, `this_month`, …) é só um RÓTULO; a identidade real
 * de uma linha periódica é o INTERVALO `(date_from, date_to)` — ver
 * `lib/meta/period.ts`. Escolher "a linha do mesmo period_key com maior
 * date_to" NÃO garante que o intervalo seja o que foi pedido: durante a janela
 * do dia entre a virada de data (no fuso de quem pediu) e o próximo sync, a
 * linha mais recente ainda é a de "ontem" -> total defasado 1 dia, silencioso.
 *
 * Regra correta:
 *   1. `date_from === from` E `date_to === to`  (intervalo EXATO)
 *   2. `attribution_window`: `unified_attribution` primeiro; o legado
 *      (`7d_click_1d_view`) só entra se NÃO houver `unified` para o MESMO
 *      intervalo — escolha determinística, nunca dependente da ordem do banco.
 *   3. sem linha exata -> `null` -> quem chama cai no fallback de
 *      `meta_insights_daily` (aditivas), sem reconstruir reach/frequency.
 */

import {
  ATTRIBUTION_PRIORITY,
  pickByAttributionPriority,
} from "@/lib/meta/insights-attribution";

/** Ordem de prioridade de `attribution_window` (reexport — fonte única). */
export const PERIODIC_ATTRIBUTION_PRIORITY = ATTRIBUTION_PRIORITY;

export interface PeriodicRowLike {
  entity_id?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  attribution_window?: unknown;
}

export interface AuthoritativePeriodOpts {
  /** range EXATO exigido — mesmo cálculo de datas de quem está pedindo o período. */
  from: string;
  to: string;
}

/**
 * De um conjunto de linhas `meta_insights_periodic` JÁ BUSCADAS (mesmo
 * level/entity/period_key), escolhe a AUTORITATIVA de UMA entidade. `null`
 * quando nenhuma linha casa o intervalo exato.
 */
export function selectAuthoritativePeriodicRow<T extends PeriodicRowLike>(
  rows: readonly T[],
  opts: AuthoritativePeriodOpts,
): T | null {
  const exact = rows.filter(
    (r) => r.date_from === opts.from && r.date_to === opts.to,
  );
  return pickByAttributionPriority(exact);
}

/** Versão multi-entidade: a linha autoritativa de CADA `entity_id`. */
export function selectAuthoritativePeriodicByEntity<T extends PeriodicRowLike>(
  rows: readonly T[],
  opts: AuthoritativePeriodOpts,
): Map<string, T> {
  const byEntity = new Map<string, T[]>();
  for (const r of rows) {
    const id = typeof r.entity_id === "string" ? r.entity_id : null;
    if (!id) continue;
    const list = byEntity.get(id);
    if (list) list.push(r);
    else byEntity.set(id, [r]);
  }
  const out = new Map<string, T>();
  for (const [id, list] of byEntity) {
    const chosen = selectAuthoritativePeriodicRow(list, opts);
    if (chosen) out.set(id, chosen);
  }
  return out;
}
