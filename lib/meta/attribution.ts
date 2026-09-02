/**
 * Helpers puros para a IDENTIDADE DE ATRIBUIÇÃO das linhas de insight.
 *
 * A sincronização não força janela de atribuição — a Insights API já retorna
 * `actions`/`action_values` na configuração unificada do conjunto de anúncios.
 * Toda linha (daily e periodic) carrega `attribution_window = 'unified_attribution'`.
 * Constantes e rótulo vivem em `./config` (`META_DEFAULT_ATTRIBUTION_WINDOW`,
 * `META_ATTRIBUTION_QUERY_VALUES`, `metaAttributionLabel`).
 */

export interface AttributionRow {
  /** chave única do insight SEM a janela (level|entity|date, ou level|entity|from|to). */
  key: string;
  attributionWindow: string;
}

/** Todas as linhas usam o MESMO identificador de atribuição? */
export function singleAttributionIdentity(
  rows: readonly { attributionWindow: string }[],
): { ok: boolean; identities: string[] } {
  const identities = [...new Set(rows.map((r) => r.attributionWindow))];
  return { ok: identities.length <= 1, identities };
}

export interface RenamePlan {
  /** linhas cujo attribution_window será trocado `from` -> `to`. */
  renamed: AttributionRow[];
  /** linhas que já estão em `to` — nada a fazer. */
  alreadyTarget: AttributionRow[];
  /** linhas fora de `from`/`to` — a renomeação não as toca. */
  untouched: AttributionRow[];
  /**
   * chaves onde renomear `from` -> `to` colidiria com uma linha `to`
   * pré-existente (dupla cópia efetiva). Deve ser SEMPRE vazio na transição
   * real (não existem linhas `to` ainda).
   */
  collisions: string[];
}

/**
 * Modela o `UPDATE ... SET attribution_window = to WHERE attribution_window = from`
 * das duas tabelas de insight — para provar que não cria linhas paralelas.
 */
export function planAttributionRename(args: {
  rows: readonly AttributionRow[];
  from: string;
  to: string;
}): RenamePlan {
  const { rows, from, to } = args;
  const targetKeys = new Set(
    rows.filter((r) => r.attributionWindow === to).map((r) => r.key),
  );

  const renamed: AttributionRow[] = [];
  const alreadyTarget: AttributionRow[] = [];
  const untouched: AttributionRow[] = [];
  const collisions: string[] = [];

  for (const r of rows) {
    if (r.attributionWindow === to) {
      alreadyTarget.push(r);
    } else if (r.attributionWindow === from) {
      renamed.push(r);
      if (targetKeys.has(r.key)) collisions.push(r.key);
    } else {
      untouched.push(r);
    }
  }

  return { renamed, alreadyTarget, untouched, collisions: [...new Set(collisions)] };
}
