/**
 * Normalização de AdCreative (Edge Function / Deno). Espelho de
 * `lib/meta/creative-normalize.ts` do app (a versão do app é a TESTADA —
 * mantenha as duas idênticas se um field da Meta mudar).
 *
 * DUAS CAMADAS: normalizada (exibição) + crua preservada
 * (`object_story_spec`, `asset_feed_spec`, `raw` inteiro). Criativos dinâmicos
 * NÃO são achatados: expõe "o principal" + contagem de variantes.
 */

export type CreativeFormat =
  | "image"
  | "video"
  | "carousel"
  | "dynamic"
  | "unknown";

// os field-sets (FULL / MINIMAL) vivem em `./creatives-fetch.ts`.

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

function rec(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

function storyData(oss: Obj | null): {
  kind: "link" | "video" | "photo" | "template" | null;
  data: Obj | null;
} {
  if (!oss) return { kind: null, data: null };
  if (rec(oss.link_data)) return { kind: "link", data: rec(oss.link_data) };
  if (rec(oss.video_data)) return { kind: "video", data: rec(oss.video_data) };
  if (rec(oss.photo_data)) return { kind: "photo", data: rec(oss.photo_data) };
  if (rec(oss.template_data)) {
    return { kind: "template", data: rec(oss.template_data) };
  }
  return { kind: null, data: null };
}

function counts(afs: Obj | null) {
  return {
    images: arr(afs?.images).length,
    videos: arr(afs?.videos).length,
    bodies: arr(afs?.bodies).length,
    titles: arr(afs?.titles).length,
    descriptions: arr(afs?.descriptions).length,
    callToActions: arr(afs?.call_to_action_types).length,
    formats: arr(afs?.ad_formats).length,
  };
}

function detectFormat(
  objectType: string | null,
  afs: Obj | null,
  c: ReturnType<typeof counts>,
  story: { kind: string | null; data: Obj | null },
  videoId: string | null,
  imageHash: string | null,
): CreativeFormat {
  const ot = (objectType ?? "").toUpperCase();
  const dynamicByFeed =
    afs != null &&
    (c.images > 1 ||
      c.videos > 1 ||
      c.bodies > 1 ||
      c.titles > 1 ||
      c.descriptions > 1);
  if (dynamicByFeed || ot === "DYNAMIC") return "dynamic";
  const child = arr(story.data?.child_attachments);
  if (child.length > 1 || ot === "CAROUSEL") return "carousel";
  if (videoId || story.kind === "video" || ot.includes("VIDEO")) return "video";
  if (
    imageHash ||
    story.kind === "photo" ||
    story.kind === "link" ||
    ["PHOTO", "SHARE", "IMAGE"].includes(ot)
  ) {
    return "image";
  }
  if (afs != null && (c.images > 0 || c.videos > 0)) return "dynamic";
  return "unknown";
}

export interface CreativeDbRow {
  client_id: string;
  ad_account_ref: string;
  ad_account_id: string;
  creative_id: string;
  name: string | null;
  object_type: string | null;
  format: CreativeFormat;
  thumbnail_url: string | null;
  image_url: string | null;
  image_hash: string | null;
  video_id: string | null;
  title: string | null;
  body: string | null;
  description: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
  object_story_id: string | null;
  effective_object_story_id: string | null;
  object_story_spec: unknown | null;
  asset_feed_spec: unknown | null;
  raw: unknown;
  synced_at: string;
  /** só quando o FULL teve sucesso — chave do fetch incremental. */
  details_fetched_at?: string | null;
}

/**
 * Payload cru de AdCreative -> linha de `public.meta_creatives`.
 * `opts.detailsFetchedAt`:
 *   - string  -> FULL ok, marca a linha como detalhada (grava a coluna);
 *   - null    -> preserva o valor atual (MINIMAL-only, não rebaixa) — a coluna
 *               NÃO entra no payload;
 *   - undefined -> idem null.
 */
export function creativeDbRow(
  input: unknown,
  ctx: { clientId: string; adAccountRef: string; adAccountId: string },
  opts?: { detailsFetchedAt?: string | null },
): CreativeDbRow | null {
  const c = rec(input);
  const creativeId = str(c?.id);
  if (!c || !creativeId) return null;

  const oss = rec(c.object_story_spec);
  const afs = rec(c.asset_feed_spec);
  const story = storyData(oss);
  const cnt = counts(afs);

  const feedImg = rec(arr(afs?.images)[0]);
  const feedVid = rec(arr(afs?.videos)[0]);
  const feedBody = rec(arr(afs?.bodies)[0]);
  const feedTitle = rec(arr(afs?.titles)[0]);
  const feedDesc = rec(arr(afs?.descriptions)[0]);
  const feedLink = rec(arr(afs?.link_urls)[0]);
  const child = rec(arr(story.data?.child_attachments)[0]);
  const ctaObj = rec(story.data?.call_to_action);

  const imageHash = firstStr(
    c.image_hash,
    story.data?.image_hash,
    child?.image_hash,
    feedImg?.hash,
  );
  const videoId = firstStr(c.video_id, story.data?.video_id, feedVid?.video_id);
  const objectType = str(c.object_type);
  const format = detectFormat(objectType, afs, cnt, story, videoId, imageHash);

  return {
    client_id: ctx.clientId,
    ad_account_ref: ctx.adAccountRef,
    ad_account_id: ctx.adAccountId,
    creative_id: creativeId,
    name: str(c.name),
    object_type: objectType,
    format,
    thumbnail_url: str(c.thumbnail_url),
    image_url: firstStr(c.image_url, feedImg?.url),
    image_hash: imageHash,
    video_id: videoId,
    title: firstStr(
      c.title,
      story.data?.name,
      story.data?.title,
      child?.name,
      feedTitle?.text,
    ),
    body: firstStr(
      c.body,
      story.data?.message,
      story.data?.caption,
      feedBody?.text,
    ),
    description: firstStr(
      story.data?.description,
      story.data?.link_description,
      child?.description,
      feedDesc?.text,
    ),
    call_to_action_type: firstStr(
      ctaObj?.type,
      c.call_to_action_type,
      arr(afs?.call_to_action_types)[0],
    ),
    link_url: firstStr(
      c.link_url,
      story.data?.link,
      rec(ctaObj?.value)?.link,
      child?.link,
      feedLink?.website_url,
    ),
    object_story_id: str(c.object_story_id),
    effective_object_story_id: str(c.effective_object_story_id),
    object_story_spec: oss ?? null,
    asset_feed_spec: afs ?? null,
    raw: input,
    synced_at: new Date().toISOString(),
    ...(typeof opts?.detailsFetchedAt === "string"
      ? { details_fetched_at: opts.detailsFetchedAt }
      : {}),
  };
}
