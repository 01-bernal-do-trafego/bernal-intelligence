/**
 * Normalização de AdCreative da Marketing API v26.0. Módulo PURO.
 *
 * DUAS CAMADAS:
 *  - normalizada (exibição simples): melhor esforço para 1 texto / 1 headline /
 *    1 imagem-ou-vídeo / 1 CTA + `format` derivado;
 *  - crua (auditoria / expansão futura): `objectStorySpec`, `assetFeedSpec` e o
 *    objeto `raw` inteiro são PRESERVADOS sem achatamento destrutivo.
 *
 * Criativos dinâmicos / flexíveis (Advantage+) têm várias imagens/vídeos/textos/
 * headlines — a camada normalizada expõe "o principal" + a CONTAGEM de variantes
 * (`assetCounts`), nunca inventa uma copy única.
 *
 * Ausência de campo => `null` (nunca string vazia). Nenhum field é presumido.
 */

export type CreativeFormat =
  | "image"
  | "video"
  | "carousel"
  | "dynamic"
  | "unknown";

export interface CreativeAssetCounts {
  images: number;
  videos: number;
  bodies: number;
  titles: number;
  descriptions: number;
  callToActions: number;
  formats: number;
}

export interface NormalizedCreative {
  creativeId: string;
  name: string | null;
  objectType: string | null;
  format: CreativeFormat;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  imageHash: string | null;
  videoId: string | null;
  /** headline principal */
  title: string | null;
  /** texto principal */
  body: string | null;
  description: string | null;
  callToActionType: string | null;
  linkUrl: string | null;
  objectStoryId: string | null;
  effectiveObjectStoryId: string | null;
  /** cru preservado (jsonb) */
  objectStorySpec: unknown | null;
  /** cru preservado (jsonb) */
  assetFeedSpec: unknown | null;
  /** objeto AdCreative inteiro como veio (auditoria) */
  raw: unknown;
  assetCounts: CreativeAssetCounts;
  hasImage: boolean;
  hasVideo: boolean;
  isDynamic: boolean;
}

export {
  CREATIVE_FIELDS_FULL,
  CREATIVE_FIELDS_MINIMAL,
} from "@/lib/meta/creative-fetch";
/** @deprecated use `CREATIVE_FIELDS_FULL` */
export { CREATIVE_FIELDS_FULL as CREATIVE_API_FIELDS } from "@/lib/meta/creative-fetch";

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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

/** `object_story_spec` -> o "*_data" ativo (link/video/photo/template). */
function storyData(oss: Record<string, unknown> | null): {
  kind: "link" | "video" | "photo" | "template" | null;
  data: Record<string, unknown> | null;
} {
  if (!oss) return { kind: null, data: null };
  const link = rec(oss.link_data);
  if (link) return { kind: "link", data: link };
  const video = rec(oss.video_data);
  if (video) return { kind: "video", data: video };
  const photo = rec(oss.photo_data);
  if (photo) return { kind: "photo", data: photo };
  const template = rec(oss.template_data);
  if (template) return { kind: "template", data: template };
  return { kind: null, data: null };
}

function assetCounts(afs: Record<string, unknown> | null): CreativeAssetCounts {
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
  afs: Record<string, unknown> | null,
  counts: CreativeAssetCounts,
  story: { kind: string | null; data: Record<string, unknown> | null },
  videoId: string | null,
  imageHash: string | null,
): CreativeFormat {
  const ot = (objectType ?? "").toUpperCase();
  const dynamicByFeed =
    afs != null &&
    (counts.images > 1 ||
      counts.videos > 1 ||
      counts.bodies > 1 ||
      counts.titles > 1 ||
      counts.descriptions > 1);
  if (dynamicByFeed || ot === "DYNAMIC") return "dynamic";

  const childAttachments = arr(story.data?.child_attachments);
  if (childAttachments.length > 1 || ot === "CAROUSEL") return "carousel";

  if (videoId || story.kind === "video" || ot.includes("VIDEO")) return "video";

  if (
    imageHash ||
    story.kind === "photo" ||
    story.kind === "link" ||
    ["PHOTO", "SHARE", "IMAGE"].includes(ot)
  ) {
    return "image";
  }
  // asset_feed_spec com 1 asset de cada tipo ainda é "dynamic" na origem
  if (afs != null && (counts.images > 0 || counts.videos > 0)) return "dynamic";
  return "unknown";
}

export function normalizeCreative(input: unknown): NormalizedCreative | null {
  const c = rec(input);
  const creativeId = str(c?.id);
  if (!c || !creativeId) return null;

  const oss = rec(c.object_story_spec);
  const afs = rec(c.asset_feed_spec);
  const story = storyData(oss);
  const counts = assetCounts(afs);

  const feedImg = rec(arr(afs?.images)[0]);
  const feedVid = rec(arr(afs?.videos)[0]);
  const feedBody = rec(arr(afs?.bodies)[0]);
  const feedTitle = rec(arr(afs?.titles)[0]);
  const feedDesc = rec(arr(afs?.descriptions)[0]);
  const feedLink = rec(arr(afs?.link_urls)[0]);
  const childFirst = rec(arr(story.data?.child_attachments)[0]);

  const cta =
    firstStr(
      rec(story.data?.call_to_action)?.type,
      c.call_to_action_type,
      arr(afs?.call_to_action_types)[0],
    ) ?? null;

  const imageHash =
    firstStr(
      c.image_hash,
      story.data?.image_hash,
      childFirst?.image_hash,
      feedImg?.hash,
    ) ?? null;

  const videoId =
    firstStr(c.video_id, story.data?.video_id, feedVid?.video_id) ?? null;

  const title =
    firstStr(
      c.title,
      story.data?.name,
      story.data?.title,
      childFirst?.name,
      feedTitle?.text,
    ) ?? null;

  const body =
    firstStr(
      c.body,
      story.data?.message,
      story.data?.caption,
      feedBody?.text,
    ) ?? null;

  const description =
    firstStr(
      story.data?.description,
      story.data?.link_description,
      childFirst?.description,
      feedDesc?.text,
    ) ?? null;

  const ctaValueLink = rec(rec(story.data?.call_to_action)?.value)?.link;
  const linkUrl =
    firstStr(
      c.link_url,
      story.data?.link,
      ctaValueLink,
      childFirst?.link,
      feedLink?.website_url,
    ) ?? null;

  const objectType = str(c.object_type);
  const format = detectFormat(objectType, afs, counts, story, videoId, imageHash);

  const hasImage =
    Boolean(imageHash) ||
    Boolean(str(c.image_url)) ||
    counts.images > 0 ||
    format === "image" ||
    format === "carousel";
  const hasVideo = Boolean(videoId) || counts.videos > 0 || format === "video";
  const isDynamic = format === "dynamic";

  return {
    creativeId,
    name: str(c.name),
    objectType,
    format,
    thumbnailUrl: str(c.thumbnail_url),
    imageUrl: firstStr(c.image_url, feedImg?.url),
    imageHash,
    videoId,
    title,
    body,
    description,
    callToActionType: cta,
    linkUrl,
    objectStoryId: str(c.object_story_id),
    effectiveObjectStoryId: str(c.effective_object_story_id),
    objectStorySpec: oss ?? null,
    assetFeedSpec: afs ?? null,
    raw: input,
    assetCounts: counts,
    hasImage,
    hasVideo,
    isDynamic,
  };
}

/** Linha snake_case para upsert em `public.meta_creatives`. */
export function creativeDbRow(
  n: NormalizedCreative,
  ctx: { clientId: string; adAccountRef: string; adAccountId: string },
): Record<string, unknown> {
  return {
    client_id: ctx.clientId,
    ad_account_ref: ctx.adAccountRef,
    ad_account_id: ctx.adAccountId,
    creative_id: n.creativeId,
    name: n.name,
    object_type: n.objectType,
    format: n.format,
    thumbnail_url: n.thumbnailUrl,
    image_url: n.imageUrl,
    image_hash: n.imageHash,
    video_id: n.videoId,
    title: n.title,
    body: n.body,
    description: n.description,
    call_to_action_type: n.callToActionType,
    link_url: n.linkUrl,
    object_story_id: n.objectStoryId,
    effective_object_story_id: n.effectiveObjectStoryId,
    object_story_spec: n.objectStorySpec,
    asset_feed_spec: n.assetFeedSpec,
    raw: n.raw,
    synced_at: new Date().toISOString(),
  };
}

/** Descrição curta das variantes p/ a UI ("3 textos · 4 headlines · 2 imagens"). */
export function assetVariantSummary(counts: CreativeAssetCounts): string | null {
  const parts: string[] = [];
  if (counts.images > 1) parts.push(`${counts.images} imagens`);
  if (counts.videos > 1) parts.push(`${counts.videos} vídeos`);
  if (counts.bodies > 1) parts.push(`${counts.bodies} textos`);
  if (counts.titles > 1) parts.push(`${counts.titles} headlines`);
  if (counts.descriptions > 1) parts.push(`${counts.descriptions} descrições`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
