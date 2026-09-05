/**
 * Prioridade determinística de `attribution_window` ao ler insights — módulo
 * PURO, compartilhado entre periodic e daily, Agency Overview e dashboard
 * individual. NUNCA somar `unified_attribution` + legado da mesma
 * conta/data/intervalo (duplicaria spend/impressions/clicks/conversões).
 */
import {
  META_ATTRIBUTION_LEGACY_WINDOW,
  META_DEFAULT_ATTRIBUTION_WINDOW,
} from "@/lib/meta/config";

/** `unified_attribution` primeiro; legado só como fallback de compatibilidade. */
export const ATTRIBUTION_PRIORITY: readonly string[] = [
  META_DEFAULT_ATTRIBUTION_WINDOW, // "unified_attribution"
  META_ATTRIBUTION_LEGACY_WINDOW, // "7d_click_1d_view"
];

/** De um conjunto de linhas (mesma chave lógica), escolhe UMA por prioridade. */
export function pickByAttributionPriority<T extends { attribution_window?: unknown }>(
  rows: readonly T[],
): T | null {
  if (rows.length === 0) return null;
  for (const window of ATTRIBUTION_PRIORITY) {
    const hit = rows.find((r) => r.attribution_window === window);
    if (hit) return hit;
  }
  // janela desconhecida (não deveria ocorrer) — determinístico: a 1ª.
  return rows[0] ?? null;
}

/**
 * De-dup de linhas por chave lógica (ex.: `entity_id|date`), escolhendo uma
 * única `attribution_window` por grupo. Devolve o array achatado, sem nunca
 * somar duas janelas de atribuição da mesma chave.
 */
export function dedupeByAttribution<T extends { attribution_window?: unknown }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = keyOf(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: T[] = [];
  for (const list of groups.values()) {
    const chosen = pickByAttributionPriority(list);
    if (chosen) out.push(chosen);
  }
  return out;
}
