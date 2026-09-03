/**
 * Busca de AdCreative — INDIVIDUAL-FIRST (Edge Function / Deno). Espelho de
 * `lib/meta/creative-fetch.ts` do app (a versão do app é a TESTADA — manter
 * idênticas).
 *
 * `?ids=` multi-get não é mais usado para AdCreative nesta V1: na sync v6
 * falhou com Meta code 100 em FULL e em MINIMAL, mas o MESMO MINIMAL funciona
 * por id. HIPÓTESE (não confirmada) de que o multi-get não é confiável p/
 * AdCreative — o próximo run confirma e, se FULL por id falhar, nomeia o field.
 *   A) GET /{id}?fields=<FULL>  ->  B) isolamento de fields + GET /{id}?<MINIMAL>.
 * `token_revoked` aborta. Erro nunca engolido.
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
  failingFieldGroup?: string | null;
}

export type GraphFetchOutcome =
  | { ok: true; object: Record<string, unknown> }
  | { ok: false; error: SanitizedGraphError };

export interface CreativeTransport {
  get(id: string, fields: string): Promise<GraphFetchOutcome>;
}

export interface CreativeFetchTelemetry {
  attempted: number;
  full_fetched: number;
  minimal_fetched: number;
  failed: number;
  full_fields_available: number;
  minimal_only: number;
  failed_ids: string[];
  degraded: boolean;
  error_codes: SanitizedGraphError[];
}

export interface CreativeFetchResult {
  objects: Map<string, Record<string, unknown>>;
  minimalOnlyIds: Set<string>;
  telemetry: CreativeFetchTelemetry;
  tokenRevoked: boolean;
}

const FAILED_IDS_CAP = 50;
const ERROR_CODES_CAP = 12;
const DEFAULT_CALL_CAP = 400;
const DEFAULT_ISOLATE_CAP = 3;

// deno-lint-ignore no-explicit-any
function asRec(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    // deno-lint-ignore no-explicit-any
    ? (v as Record<string, any>)
    : null;
}

export function sanitizeGraphError(body: unknown): SanitizedGraphError {
  const e = asRec(asRec(body)?.error);
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
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

export async function isolateFailingFieldGroup(
  id: string,
  transport: CreativeTransport,
): Promise<{ group: string | null; error: SanitizedGraphError | null; calls: number }> {
  let acc = ["id", "name"];
  let calls = 1;
  const baseline = await transport.get(id, acc.join(","));
  if (!baseline.ok) return { group: null, error: baseline.error, calls };
  for (const grp of CREATIVE_FIELD_GROUPS) {
    acc = [...acc, ...grp.fields];
    calls += 1;
    const r = await transport.get(id, acc.join(","));
    if (!r.ok) {
      return {
        group: grp.name,
        error: { ...r.error, failingFieldGroup: grp.name },
        calls,
      };
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
    if (tel.failed_ids.length < FAILED_IDS_CAP) tel.failed_ids.push(id);
  };

  for (const id of uniq) {
    if (tokenRevoked) break;
    if (calls >= callCap) {
      markFailed(id);
      continue;
    }

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

    if (
      isolations < isolateCap &&
      calls + CREATIVE_FIELD_GROUPS.length + 1 <= callCap
    ) {
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

export type StageOutcome = "done" | "degraded" | "error";

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

export function planAdCreativeLinks(args: {
  pairs: { adId: string; creativeId: string }[];
  adRefByMetaId: Map<string, string>;
  savedCreativeIds: Set<string>;
}): {
  links: { adId: string; creativeId: string; adRef: string }[];
  skipped: number;
  attempted: number;
} {
  const links: { adId: string; creativeId: string; adRef: string }[] = [];
  let skipped = 0;
  for (const p of args.pairs) {
    const ar = args.adRefByMetaId.get(p.adId);
    if (!ar || !args.savedCreativeIds.has(p.creativeId)) {
      skipped += 1;
      continue;
    }
    links.push({ adId: p.adId, creativeId: p.creativeId, adRef: ar });
  }
  return { links, skipped, attempted: args.pairs.length };
}

/* ---- transporte real (fetch) ----------------------------------- */

/** `CreativeTransport` real sobre a Graph API. Token só no header. */
export function graphCreativeTransport(graph: {
  graphBase: string;
  version: string;
  token: string;
}): CreativeTransport {
  const root = `${graph.graphBase.replace(/\/+$/, "")}/${graph.version}`;
  return {
    async get(id, fields) {
      const url = new URL(`${root}/${encodeURIComponent(id)}`);
      url.searchParams.set("fields", fields);
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${graph.token}` },
      });
      const body = (await res.json().catch(() => null)) as unknown;
      const rec = asRec(body);
      if (res.ok && rec && !("error" in rec)) {
        return { ok: true, object: rec };
      }
      return { ok: false, error: sanitizeGraphError(body) };
    },
  };
}
