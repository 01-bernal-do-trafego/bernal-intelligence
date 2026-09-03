import { describe, expect, it } from "vitest";
import {
  assetVariantSummary,
  creativeDbRow,
  normalizeCreative,
} from "@/lib/meta/creative-normalize";

const ctx = { clientId: "c1", adAccountRef: "acc-ref", adAccountId: "act_1" };

describe("normalizeCreative — camada normalizada + raw preservado", () => {
  it("id ausente => null", () => {
    expect(normalizeCreative({})).toBeNull();
    expect(normalizeCreative(null)).toBeNull();
  });

  it("creative de IMAGEM (object_story_spec.link_data)", () => {
    const n = normalizeCreative({
      id: "111",
      name: "Promo imagem",
      object_type: "SHARE",
      thumbnail_url: "https://scontent.example/thumb.jpg",
      image_hash: "abc123",
      object_story_spec: {
        link_data: {
          message: "Texto principal aqui",
          name: "Minha headline",
          description: "descrição",
          link: "https://loja.example/x",
          image_hash: "abc123",
          call_to_action: { type: "SHOP_NOW" },
        },
      },
    })!;
    expect(n.format).toBe("image");
    expect(n.body).toBe("Texto principal aqui");
    expect(n.title).toBe("Minha headline");
    expect(n.description).toBe("descrição");
    expect(n.callToActionType).toBe("SHOP_NOW");
    expect(n.linkUrl).toBe("https://loja.example/x");
    expect(n.imageHash).toBe("abc123");
    expect(n.hasImage).toBe(true);
    expect(n.hasVideo).toBe(false);
    expect(n.isDynamic).toBe(false);
    // raw cru preservado
    expect(n.objectStorySpec).toMatchObject({ link_data: { message: "Texto principal aqui" } });
    expect(n.raw).toMatchObject({ id: "111" });
  });

  it("creative de VÍDEO (video_data)", () => {
    const n = normalizeCreative({
      id: "222",
      object_type: "VIDEO",
      video_id: "vid_999",
      object_story_spec: {
        video_data: {
          message: "assista",
          title: "Headline vídeo",
          video_id: "vid_999",
          call_to_action: { type: "LEARN_MORE" },
        },
      },
    })!;
    expect(n.format).toBe("video");
    expect(n.videoId).toBe("vid_999");
    expect(n.hasVideo).toBe(true);
    expect(n.title).toBe("Headline vídeo");
    expect(n.callToActionType).toBe("LEARN_MORE");
  });

  it("creative sem image_url e sem thumbnail (só hash) — não quebra", () => {
    const n = normalizeCreative({ id: "333", object_type: "SHARE", image_hash: "h1" })!;
    expect(n.thumbnailUrl).toBeNull();
    expect(n.imageUrl).toBeNull();
    expect(n.imageHash).toBe("h1");
    expect(n.format).toBe("image");
  });

  it("creative sem nenhum visual identificável => unknown, sem inventar", () => {
    const n = normalizeCreative({ id: "334", name: "x" })!;
    expect(n.format).toBe("unknown");
    expect(n.body).toBeNull();
    expect(n.title).toBeNull();
  });

  it("CARROSSEL: child_attachments > 1", () => {
    const n = normalizeCreative({
      id: "444",
      object_story_spec: {
        link_data: {
          message: "carrossel",
          child_attachments: [
            { name: "card 1", link: "https://a", image_hash: "i1" },
            { name: "card 2", link: "https://b", image_hash: "i2" },
          ],
        },
      },
    })!;
    expect(n.format).toBe("carousel");
    expect(n.title).toBe("card 1"); // principal, não inventa uma única
    expect(n.linkUrl).toBe("https://a");
  });

  it("DYNAMIC / asset_feed_spec com múltiplos assets — não achata", () => {
    const n = normalizeCreative({
      id: "555",
      object_type: "SHARE",
      asset_feed_spec: {
        images: [{ hash: "im1", url: "https://i1" }, { hash: "im2" }],
        videos: [{ video_id: "v1" }],
        bodies: [{ text: "texto A" }, { text: "texto B" }, { text: "texto C" }],
        titles: [{ text: "head 1" }, { text: "head 2" }, { text: "head 3" }, { text: "head 4" }],
        descriptions: [{ text: "d1" }],
        call_to_action_types: ["SHOP_NOW", "LEARN_MORE"],
        ad_formats: ["SINGLE_IMAGE", "SINGLE_VIDEO"],
      },
    })!;
    expect(n.format).toBe("dynamic");
    expect(n.isDynamic).toBe(true);
    expect(n.assetCounts).toEqual({
      images: 2,
      videos: 1,
      bodies: 3,
      titles: 4,
      descriptions: 1,
      callToActions: 2,
      formats: 2,
    });
    // "o principal" vem do 1º asset, sem afirmar copy única
    expect(n.body).toBe("texto A");
    expect(n.title).toBe("head 1");
    expect(n.imageHash).toBe("im1");
    expect(n.videoId).toBe("v1");
    // asset_feed_spec cru preservado INTEGRALMENTE (as 3 variantes de texto)
    expect((n.assetFeedSpec as { bodies: unknown[] }).bodies).toHaveLength(3);
    expect((n.assetFeedSpec as { titles: unknown[] }).titles).toHaveLength(4);
  });

  it("texto ÚNICO vs MÚLTIPLOS — assetVariantSummary", () => {
    const single = normalizeCreative({
      id: "556",
      asset_feed_spec: { bodies: [{ text: "único" }], titles: [{ text: "h" }] },
    })!;
    expect(assetVariantSummary(single.assetCounts)).toBeNull();

    const multi = normalizeCreative({
      id: "557",
      asset_feed_spec: {
        bodies: [{ text: "a" }, { text: "b" }, { text: "c" }],
        titles: [{ text: "h1" }, { text: "h2" }],
        images: [{ hash: "i1" }, { hash: "i2" }],
      },
    })!;
    expect(assetVariantSummary(multi.assetCounts)).toBe("2 imagens · 3 textos · 2 headlines");
  });

  it("headline única vs múltiplas — contagem correta", () => {
    const one = normalizeCreative({ id: "558", asset_feed_spec: { titles: [{ text: "só uma" }] } })!;
    expect(one.assetCounts.titles).toBe(1);
    const many = normalizeCreative({
      id: "559",
      asset_feed_spec: { titles: [{ text: "a" }, { text: "b" }, { text: "c" }] },
    })!;
    expect(many.assetCounts.titles).toBe(3);
  });

  it("fetch MÍNIMO (sem object_story_spec / asset_feed_spec) ainda gera creative", () => {
    // payload como volta do field-set mínimo do fallback
    const n = normalizeCreative({
      id: "601",
      name: "Só o mínimo",
      object_type: "VIDEO",
      thumbnail_url: "https://scontent.example/t.jpg",
      image_url: null,
      image_hash: null,
      video_id: "v_601",
      object_story_id: "PP_601",
      effective_object_story_id: "PP_601_eff",
    })!;
    expect(n.creativeId).toBe("601");
    expect(n.format).toBe("video");
    expect(n.hasVideo).toBe(true);
    // opcionais ausentes -> null, NÃO descarta o creative
    expect(n.body).toBeNull();
    expect(n.title).toBeNull();
    expect(n.callToActionType).toBeNull();
    expect(n.objectStorySpec).toBeNull();
    expect(n.assetFeedSpec).toBeNull();
    // ainda vira linha de banco
    const row = creativeDbRow(n, ctx);
    expect(row.creative_id).toBe("601");
    expect(row.object_story_spec).toBeNull();
    expect(row.asset_feed_spec).toBeNull();
    expect(row.thumbnail_url).toBe("https://scontent.example/t.jpg");
  });

  it("effective_object_story_id e object_story_id preservados", () => {
    const n = normalizeCreative({
      id: "560",
      object_story_id: "PAGE_POST_1",
      effective_object_story_id: "PAGE_POST_1_EFF",
    })!;
    expect(n.objectStoryId).toBe("PAGE_POST_1");
    expect(n.effectiveObjectStoryId).toBe("PAGE_POST_1_EFF");
  });
});

describe("creativeDbRow — linha para meta_creatives", () => {
  it("mapeia snake_case e preserva jsonb cru", () => {
    const n = normalizeCreative({
      id: "777",
      name: "N",
      object_type: "VIDEO",
      video_id: "v",
      object_story_spec: { video_data: { message: "m", video_id: "v" } },
      asset_feed_spec: { videos: [{ video_id: "v" }] },
    })!;
    const row = creativeDbRow(n, ctx);
    expect(row).toMatchObject({
      client_id: "c1",
      ad_account_ref: "acc-ref",
      ad_account_id: "act_1",
      creative_id: "777",
      format: "video",
      video_id: "v",
    });
    expect(row.object_story_spec).toMatchObject({ video_data: { message: "m" } });
    expect(row.asset_feed_spec).toMatchObject({ videos: [{ video_id: "v" }] });
    expect(row.raw).toMatchObject({ id: "777" });
    expect(typeof row.synced_at).toBe("string");
  });
});
