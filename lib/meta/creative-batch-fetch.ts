/**
 * Busca EM CAMADAS dos detalhes de AdCreative + telemetria. Módulo PURO.
 *
 * A v5 engolia qualquer erro Graph não-`token_revoked` (`continue` silencioso),
 * então 61 creative_ids → 0 criativos → run "success". Aqui o erro NUNCA some:
 *
 *   A) batch `?ids=` com o field-set COMPLETO
 *   B) se A falhar (erro não-token): batch `?ids=` com o field-set MÍNIMO
 *   C) se B falhar: fallback por id (`GET /{id}`) com o field-set MÍNIMO
 *      — um creative inválido/deletado derruba só a si mesmo, com teto de
 *        chamadas (`perIdCap`).
 *
 * `token_revoked` (190 / 102·463) aborta tudo imediatamente.
 * Nada de token / Authorization / URL com credencial é registrado — só
 * `code`, `error_subcode`, `type`, `error_user_title`, `fbtrace_id`, nome do
 * stage e nº de ids do chunk.
 *
 * NÃO assume causa: `error_codes` carrega o code/subcode reais da Meta para o
 * próximo run revelar se é permissão / campo / get inválido / creative
 * indisponível.
 */

export const CREATIVE_FIELDS_FULL = [
  "id",
  "name",
  "object_type",
  "thumbnail_url",
  "image_url",
  "image_hash",
  "video_id",
  "title",
  "body",
  "link_url",
  "call_to_action_type",
  "object_story_id",
  "effective_object_story_id",
  "object_story_spec",
  "asset_feed_spec",
].join(",");

/**
 * Mínimo de LEITURA — sem os specs ricos que podem exigir escopo/permissão
 * extra. Copy/headline/CTA/link são derivados de `object_story_spec`/
 * `asset_feed_spec` no full; no mínimo ficam null (aceitável — o creative
 * ainda é salvo). NÃO reduzir mais: `id`+`name` sozinhos não permitem sequer
 * classificar `format`/preview.
 */
export const CREATIVE_FIELDS_MINIMAL = [
  "id",
  "name",
  "object_type",
  "thumbnail_url",
  "image_url",
  "image_hash",
  "video_id",
  "object_story_id",
  "effective_object_story_id",
].join(",");

export interface SanitizedGraphError {
  code: number | null;
  subcode: number | null;
  type: string | null;
  userTitle: string | null;
  fbtrace: string | null;
}

export type GraphFetchOutcome =
  | { ok: true; objects: Record<string, unknown> }
  | { ok: false; error: SanitizedGraphError };

export interface CreativeTransport {
  /** GET /?ids=<ids>&fields=<fields> — resposta `{ "<id>": obj }`. */
  batch(ids: string[], fields: string): Promise<GraphFetchOutcome>;
  /** GET /{id}?fields=<fields> — normalizar p/ `{ "<id>": obj }`. */
  single(id: string, fields: string): Promise<GraphFetchOutcome>;
}

export interface CreativeFetchTelemetry {
  attempted: number;
  chunks: number;
  full_fetched: number;
  fallback_fetched: number;
  minimal_fields_used: boolean;
  per_id_fallback_used: boolean;
  failed: number;
  failed_ids: string[];
  degraded: boolean;
  error_codes: SanitizedGraphError[];
}

export interface CreativeFetchResult {
  objects: Map<string, Record<string, unknown>>;
  telemetry: CreativeFetchTelemetry;
  tokenRevoked: boolean;
}

const FAILED_IDS_CAP = 50;
const ERROR_CODES_CAP = 12;
const DEFAULT_CHUNK = 50;
const DEFAULT_PER_ID_CAP = 150;

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Extrai SÓ os campos seguros de um corpo `{ error: {...} }`. Nunca inclui token. */
export function sanitizeGraphError(body: unknown): SanitizedGraphError {
  const e = asRec(asRec(body)?.error);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0 ? v.slice(0, 120) : null;
  return {
    code: n(e?.code),
    subcode: n(e?.error_subcode),
    type: s(e?.type),
    userTitle: s(e?.error_user_title),
    fbtrace: s(e?.fbtrace_id),
  };
}

export function isTokenRevoked(err: SanitizedGraphError): boolean {
  return err.code === 190 || (err.code === 102 && err.subcode === 463);
}

function sameError(a: SanitizedGraphError, b: SanitizedGraphError): boolean {
  return a.code === b.code && a.subcode === b.subcode && a.type === b.type;
}

/** Orquestra A -> B -> C sobre um transporte injetável. */
export async function planCreativeFetch(args: {
  ids: string[];
  transport: CreativeTransport;
  fullFields?: string;
  minimalFields?: string;
  chunkSize?: number;
  perIdCap?: number;
}): Promise<CreativeFetchResult> {
  const fullFields = args.fullFields ?? CREATIVE_FIELDS_FULL;
  const minimalFields = args.minimalFields ?? CREATIVE_FIELDS_MINIMAL;
  const chunkSize = Math.min(Math.max(args.chunkSize ?? DEFAULT_CHUNK, 1), 50);
  const perIdCap = Math.max(args.perIdCap ?? DEFAULT_PER_ID_CAP, 0);

  const uniq = [...new Set(args.ids.filter((x) => typeof x === "string" && x))];
  const objects = new Map<string, Record<string, unknown>>();
  const tel: CreativeFetchTelemetry = {
    attempted: uniq.length,
    chunks: 0,
    full_fetched: 0,
    fallback_fetched: 0,
    minimal_fields_used: false,
    per_id_fallback_used: false,
    failed: 0,
    failed_ids: [],
    degraded: false,
    error_codes: [],
  };
  let tokenRevoked = false;
  let singleCalls = 0;

  const recordError = (err: SanitizedGraphError) => {
    if (
      tel.error_codes.length < ERROR_CODES_CAP &&
      !tel.error_codes.some((e) => sameError(e, err))
    ) {
      tel.error_codes.push(err);
    }
  };
  const markFailed = (id: string) => {
    if (tel.failed_ids.length < FAILED_IDS_CAP) tel.failed_ids.push(id);
  };
  const mergeObjects = (map: Record<string, unknown>) => {
    let n = 0;
    for (const [id, obj] of Object.entries(map)) {
      const r = asRec(obj);
      if (r) {
        objects.set(id, r);
        n += 1;
      }
    }
    return n;
  };

  for (let i = 0; i < uniq.length && !tokenRevoked; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    tel.chunks += 1;

    // A — full batch
    const a = await args.transport.batch(chunk, fullFields);
    if (a.ok) {
      tel.full_fetched += mergeObjects(a.objects);
      continue;
    }
    if (isTokenRevoked(a.error)) {
      tokenRevoked = true;
      recordError(a.error);
      break;
    }
    recordError(a.error);
    tel.degraded = true;

    // B — minimal batch
    const b = await args.transport.batch(chunk, minimalFields);
    if (b.ok) {
      tel.minimal_fields_used = true;
      tel.fallback_fetched += mergeObjects(b.objects);
      continue;
    }
    if (isTokenRevoked(b.error)) {
      tokenRevoked = true;
      recordError(b.error);
      break;
    }
    recordError(b.error);

    // C — per-id fallback (minimal)
    tel.per_id_fallback_used = true;
    for (const id of chunk) {
      if (singleCalls >= perIdCap) {
        markFailed(id);
        continue;
      }
      singleCalls += 1;
      const c = await args.transport.single(id, minimalFields);
      if (c.ok) {
        tel.fallback_fetched += mergeObjects(c.objects);
        continue;
      }
      if (isTokenRevoked(c.error)) {
        tokenRevoked = true;
        recordError(c.error);
        break;
      }
      recordError(c.error);
      markFailed(id);
    }
  }

  tel.failed = Math.max(0, tel.attempted - objects.size);
  tel.degraded = tel.minimal_fields_used || tel.per_id_fallback_used || tel.failed > 0;

  return { objects, telemetry: tel, tokenRevoked };
}

/* ------------------------------------------------------------------ */
/* Decisão de outcome dos stages (pura — testável fora do Deno)       */
/* ------------------------------------------------------------------ */

export type StageOutcome = "done" | "degraded" | "error";

/**
 * `creatives`:
 *   fatal / (esperava ids e obteve 0)  -> error
 *   degradou (fallback) ou algum falhou -> degraded
 *   tudo cheio                          -> done
 */
export function creativesStageOutcome(input: {
  attempted: number;
  fetched: number;
  degraded: boolean;
  failed: number;
  fatal?: boolean;
}): StageOutcome {
  if (input.fatal) return "error";
  if (input.attempted > 0 && input.fetched === 0) return "error";
  if (input.degraded || input.failed > 0) return "degraded";
  return "done";
}

/**
 * `ad_creatives`:
 *   fatal / (esperava ligar e ligou 0)   -> error
 *   pulou alguma (creative não salvo)    -> degraded
 *   ligou tudo                           -> done
 */
export function linkStageOutcome(input: {
  attempted: number;
  linked: number;
  skipped: number;
  fatal?: boolean;
}): StageOutcome {
  if (input.fatal) return "error";
  if (input.attempted > 0 && input.linked === 0) return "error";
  if (input.skipped > 0) return "degraded";
  return "done";
}

/**
 * Plano de links ad↔creative — SÓ liga creatives que foram REALMENTE salvos.
 * `skipped` = par cujo creative não entrou em `meta_creatives` (fetch falhou
 * para ele) ou cujo ad não resolveu.
 */
export function planAdCreativeLinks(args: {
  pairs: { adId: string; creativeId: string }[];
  adRefByMetaId: Map<string, string> | Record<string, string>;
  savedCreativeIds: Set<string> | Iterable<string>;
}): {
  links: { adId: string; creativeId: string; adRef: string }[];
  skipped: number;
  attempted: number;
} {
  const adRef =
    args.adRefByMetaId instanceof Map
      ? args.adRefByMetaId
      : new Map(Object.entries(args.adRefByMetaId));
  const saved =
    args.savedCreativeIds instanceof Set
      ? args.savedCreativeIds
      : new Set(args.savedCreativeIds);
  const links: { adId: string; creativeId: string; adRef: string }[] = [];
  let skipped = 0;
  for (const p of args.pairs) {
    const ar = adRef.get(p.adId);
    if (!ar || !saved.has(p.creativeId)) {
      skipped += 1;
      continue;
    }
    links.push({ adId: p.adId, creativeId: p.creativeId, adRef: ar });
  }
  return { links, skipped, attempted: args.pairs.length };
}
