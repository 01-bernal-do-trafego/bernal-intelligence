/**
 * Fetch INCREMENTAL de detalhes de AdCreative. Módulo PURO.
 *
 * A observação `ad → creative` (`meta_ad_creatives.last_seen`) roda em TODO
 * sync (barato). O GET FULL do objeto creative só roda para:
 *   - creative novo (não existe em `meta_creatives`);
 *   - creative sem detalhe (`details_fetched_at IS NULL` — salvo só via MINIMAL);
 *   - detalhe stale (`details_fetched_at` mais velho que o TTL, 24h).
 * Creative já FULL e fresco -> 0 chamadas.
 */

export const CREATIVE_DETAILS_TTL_HOURS = 24;

export interface KnownCreative {
  detailsFetchedAt: string | null;
}

/** Subconjunto de `referenced` que precisa de GET FULL agora. */
export function creativeIdsNeedingFull(args: {
  referenced: readonly string[];
  known: Map<string, KnownCreative> | Record<string, KnownCreative>;
  now?: number;
  ttlHours?: number;
}): string[] {
  const now = args.now ?? Date.now();
  const staleBefore = now - (args.ttlHours ?? CREATIVE_DETAILS_TTL_HOURS) * 3_600_000;
  const get = (id: string): KnownCreative | undefined =>
    args.known instanceof Map
      ? args.known.get(id)
      : (args.known as Record<string, KnownCreative>)[id];

  return [...new Set(args.referenced.filter((x) => typeof x === "string" && x))].filter(
    (id) => {
      const k = get(id);
      if (!k) return true; // novo
      if (k.detailsFetchedAt == null) return true; // sem detalhe (minimal-only)
      const t = Date.parse(k.detailsFetchedAt);
      return !Number.isFinite(t) || t < staleBefore; // stale
    },
  );
}

/**
 * `details_fetched_at` a gravar por creative depois do fetch:
 *   - veio FULL          -> `nowIso` (marca detalhado)
 *   - veio só MINIMAL    -> preserva o valor atual (não rebaixa; se novo, null)
 */
export function detailsFetchedAtFor(
  id: string,
  cameMinimalOnly: boolean,
  currentById: Map<string, string | null> | Record<string, string | null>,
  nowIso: string,
): string | null {
  if (!cameMinimalOnly) return nowIso;
  const cur =
    currentById instanceof Map
      ? currentById.get(id)
      : (currentById as Record<string, string | null>)[id];
  return cur ?? null;
}
