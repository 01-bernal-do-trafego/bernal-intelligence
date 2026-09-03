/**
 * Busca dos detalhes de AdCreative — INDIVIDUAL-FIRST. Módulo PURO.
 *
 * Evidência (Atacado do Chinelo, sync v6):
 *   - `GET /?ids=…` (multi-get) FULL   -> Meta code 100
 *   - `GET /?ids=…` (multi-get) MINIMAL -> Meta code 100
 *   - `GET /{id}` (individual)  MINIMAL -> 61/61 OK
 * O MESMO field-set mínimo funciona por id mas falhou no `?ids=`. HIPÓTESE
 * (não confirmada até o próximo teste real): o multi-get `?ids=` não é um
 * caminho de leitura confiável para AdCreative. Não sabemos ainda se FULL por
 * id funciona nem qual field/subcode exato causou o code 100.
 * Decisão desta V1: `?ids=` não é mais usado para creatives — busca
 * individual-first, com isolamento progressivo de fields quando FULL por id
 * falha (para nomear o suspeito no próximo run).
 *
 * Por creative_id (com teto de chamadas):
 *   A) GET /{id}?fields=<FULL>            -> full_fetched
 *   B) se A falhar (não-token):
 *      - isolamento progressivo de grupos de fields (nos primeiros N ids que
 *        falham) para nomear o field que quebra;
 *      - GET /{id}?fields=<MINIMAL>       -> minimal_fetched (minimal_only)
 *      - se MINIMAL também falhar         -> failed
 *   token_revoked (190 / 102·463) aborta tudo.
 *
 * Erro NUNCA engolido: `sanitizeGraphError` extrai só code/subcode/type/
 * user_title/fbtrace (nada de token/URL/message). Upsert por `creative_id` só
 * ENRIQUECE as linhas já salvas (zero duplicação).
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

/**
 * Grupos ADITIVOS para isolamento progressivo — cada probe pede
 * `id,name` + união dos grupos até `i`. O 1º grupo que faz a chamada falhar é
 * o suspeito.
 */
export const CREATIVE_FIELD_GROUPS: { name: string; fields: string[] }[] = [
  { name: "base", fields: ["object_type"] },
  { name: "image", fields: ["thumbnail_url", "image_url", "image_hash"] },
  { name: "video", fields: ["video_id"] },
  { name: "story_ids", fields: ["object_story_id", "effective_object_story_id"] },
  { name: "copy", fields: ["title", "body", "link_url", "call_to_action_type"] },
  { name: "object_story_spec", fields: ["object_story_spec"] },
  { name: "asset_feed_spec", fields: ["asset_feed_spec"] },
];

export interface SanitizedGraphError {
  code: number | null;
  subcode: number | null;
  type: string | null;
  userTitle: string | null;
  fbtrace: string | null;
  /** grupo de fields que a isolação apontou como quebra (quando rodou). */
  failingFieldGroup?: string | null;
}

export type GraphFetchOutcome =
  | { ok: true; object: Record<string, unknown> }
  | { ok: false; error: SanitizedGraphError };

export interface CreativeTransport {
  /** GET /{id}?fields=<fields> — devolve o objeto do creative. */
  get(id: string, fields: string): Promise<GraphFetchOutcome>;
}

export interface CreativeFetchTelemetry {
  attempted: number;
  full_fetched: number;
  minimal_fetched: number;
  failed: number;
  /** ids cujo FULL individual funcionou. */
  full_fields_available: number;
  /** ids salvos só com o field-set mínimo (linha incompleta). */
  minimal_only: number;
  failed_ids: string[];
  degraded: boolean;
  error_codes: SanitizedGraphError[];
}

export interface CreativeFetchResult {
  objects: Map<string, Record<string, unknown>>;
  /** creative_ids que vieram apenas com fields mínimos. */
  minimalOnlyIds: Set<string>;
  telemetry: CreativeFetchTelemetry;
  tokenRevoked: boolean;
}

const FAILED_IDS_CAP = 50;
const ERROR_CODES_CAP = 12;
const DEFAULT_CALL_CAP = 400;
const DEFAULT_ISOLATE_CAP = 3;

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

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
  return (
    a.code === b.code &&
    a.subcode === b.subcode &&
    a.type === b.type &&
    (a.failingFieldGroup ?? null) === (b.failingFieldGroup ?? null)
  );
}

/**
 * Isolamento progressivo: `id,name` + grupos aditivos até achar o 1º que
 * quebra. Devolve o nome do grupo suspeito (ou null se nenhum grupo isolado
 * falhou — nesse caso a falha não é de field).
 */
export async function isolateFailingFieldGroup(
  id: string,
  transport: CreativeTransport,
): Promise<{ group: string | null; error: SanitizedGraphError | null; calls: number }> {
  let acc = ["id", "name"];
  let calls = 0;
  // baseline id,name deve funcionar; se nem isso, não é field.
  calls += 1;
  const baseline = await transport.get(id, acc.join(","));
  if (!baseline.ok) return { group: null, error: baseline.error, calls };
  for (const grp of CREATIVE_FIELD_GROUPS) {
    acc = [...acc, ...grp.fields];
    calls += 1;
    const r = await transport.get(id, acc.join(","));
    if (!r.ok) {
      return { group: grp.name, error: { ...r.error, failingFieldGroup: grp.name }, calls };
    }
  }
  return { group: null, error: null, calls };
}

export async function planCreativeFetch(args: {
  ids: string[];
  transport: CreativeTransport;
  fullFields?: string;
  minimalFields?: string;
  callCap?: number;
  isolateCap?: number;
}): Promise<CreativeFetchResult> {
  const fullFields = args.fullFields ?? CREATIVE_FIELDS_FULL;
  const minimalFields = args.minimalFields ?? CREATIVE_FIELDS_MINIMAL;
  const callCap = Math.max(args.callCap ?? DEFAULT_CALL_CAP, 0);
  const isolateCap = Math.max(args.isolateCap ?? DEFAULT_ISOLATE_CAP, 0);

  const uniq = [...new Set(args.ids.filter((x) => typeof x === "string" && x))];
  const objects = new Map<string, Record<string, unknown>>();
  const minimalOnlyIds = new Set<string>();
  const tel: CreativeFetchTelemetry = {
    attempted: uniq.length,
    full_fetched: 0,
    minimal_fetched: 0,
    failed: 0,
    full_fields_available: 0,
    minimal_only: 0,
    failed_ids: [],
    degraded: false,
    error_codes: [],
  };
  let tokenRevoked = false;
  let calls = 0;
  let isolations = 0;

  const recordError = (err: SanitizedGraphError) => {
    if (
      tel.error_codes.length < ERROR_CODES_CAP &&
      !tel.error_codes.some((e) => sameError(e, err))
    ) {
      tel.error_codes.push(err);
    }
  };
  const markFailed = (id: string) => {
    tel.failed += 1;
    if (tel.failed_ids.length < FAILED_IDS_CAP) tel.failed_ids.push(id);
  };

  for (const id of uniq) {
    if (tokenRevoked) break;
    if (calls >= callCap) {
      markFailed(id);
      continue;
    }

    // A — FULL individual
    calls += 1;
    const a = await args.transport.get(id, fullFields);
    if (a.ok) {
      objects.set(id, a.object);
      tel.full_fetched += 1;
      tel.full_fields_available += 1;
      continue;
    }
    if (isTokenRevoked(a.error)) {
      tokenRevoked = true;
      recordError(a.error);
      break;
    }
    recordError(a.error);

    // isolamento progressivo (só nos primeiros N que falham) para nomear o field
    if (isolations < isolateCap && calls + CREATIVE_FIELD_GROUPS.length + 1 <= callCap) {
      isolations += 1;
      const iso = await isolateFailingFieldGroup(id, args.transport);
      calls += iso.calls;
      if (iso.error) {
        if (isTokenRevoked(iso.error)) {
          tokenRevoked = true;
          recordError(iso.error);
          break;
        }
        recordError(iso.error);
      }
    }

    // B — MINIMAL individual
    if (calls >= callCap) {
      markFailed(id);
      continue;
    }
    calls += 1;
    const b = await args.transport.get(id, minimalFields);
    if (b.ok) {
      objects.set(id, b.object);
      minimalOnlyIds.add(id);
      tel.minimal_fetched += 1;
      continue;
    }
    if (isTokenRevoked(b.error)) {
      tokenRevoked = true;
      recordError(b.error);
      break;
    }
    recordError(b.error);
    markFailed(id);
  }

  tel.minimal_only = minimalOnlyIds.size;
  tel.failed = Math.max(0, tel.attempted - objects.size);
  tel.failed_ids = tel.failed_ids.slice(0, FAILED_IDS_CAP);
  tel.degraded = tel.minimal_only > 0 || tel.failed > 0;

  return { objects, minimalOnlyIds, telemetry: tel, tokenRevoked };
}

/* ------------------------------------------------------------------ */
/* Decisão de outcome dos stages (pura)                               */
/* ------------------------------------------------------------------ */

export type StageOutcome = "done" | "degraded" | "error";

/**
 * `creatives`:
 *   fatal / (esperava ids e obteve 0)          -> error
 *   algum só com mínimo (linha incompleta)
 *     ou algum falhou totalmente               -> degraded (=> run partial)
 *   61 FULL / 61 salvos                         -> done (=> run success)
 */
export function creativesStageOutcome(input: {
  attempted: number;
  fetched: number;
  minimalOnly: number;
  failed: number;
  fatal?: boolean;
}): StageOutcome {
  if (input.fatal) return "error";
  if (input.attempted > 0 && input.fetched === 0) return "error";
  if (input.minimalOnly > 0 || input.failed > 0) return "degraded";
  return "done";
}

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

/** Plano de links ad↔creative — SÓ liga creatives REALMENTE salvos. */
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
