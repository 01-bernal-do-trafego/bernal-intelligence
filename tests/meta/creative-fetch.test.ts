import { describe, expect, it, vi } from "vitest";
import {
  CREATIVE_FIELDS_FULL,
  CREATIVE_FIELDS_MINIMAL,
  CREATIVE_FIELD_GROUPS,
  creativesStageOutcome,
  isolateFailingFieldGroup,
  isTokenRevoked,
  linkStageOutcome,
  planAdCreativeLinks,
  planCreativeFetch,
  sanitizeGraphError,
  type CreativeTransport,
  type GraphFetchOutcome,
} from "@/lib/meta/creative-fetch";

const obj = (o: Record<string, unknown>): GraphFetchOutcome => ({ ok: true, object: o });
const err = (
  code: number,
  extra: Partial<{ error_subcode: number; type: string; error_user_title: string }> = {},
): GraphFetchOutcome => ({
  ok: false,
  error: sanitizeGraphError({ error: { code, message: "boom", ...extra } }),
});

function transport(
  route: (id: string, fields: string) => GraphFetchOutcome,
): CreativeTransport & { calls: { id: string; fields: string }[] } {
  const calls: { id: string; fields: string }[] = [];
  return {
    calls,
    get: vi.fn(async (id: string, fields: string) => {
      calls.push({ id, fields });
      return route(id, fields);
    }),
  };
}

const has = (fields: string, f: string) => fields.split(",").includes(f);

describe("planCreativeFetch — INDIVIDUAL-FIRST (?ids= abandonado)", () => {
  it("FULL individual funciona para todos -> 61 full, 0 minimal, done", async () => {
    const t = transport((id) => obj({ id, name: `c${id}`, object_story_spec: { x: 1 } }));
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
    const r = await planCreativeFetch({ ids, transport: t });
    expect(r.objects.size).toBe(61);
    expect(r.telemetry.full_fetched).toBe(61);
    expect(r.telemetry.full_fields_available).toBe(61);
    expect(r.telemetry.minimal_only).toBe(0);
    expect(r.telemetry.failed).toBe(0);
    expect(r.telemetry.degraded).toBe(false);
    // 1 chamada por id, sempre FULL
    expect(t.calls).toHaveLength(61);
    expect(t.calls.every((c) => c.fields === CREATIVE_FIELDS_FULL)).toBe(true);
    expect(
      creativesStageOutcome({ attempted: 61, fetched: 61, minimalOnly: 0, failed: 0 }),
    ).toBe("done");
  });

  it("FULL individual falha (#100) -> MINIMAL individual funciona -> minimal_only, degraded", async () => {
    const t = transport((id, fields) =>
      fields === CREATIVE_FIELDS_FULL ? err(100, { type: "GraphMethodException" }) : obj({ id }),
    );
    const r = await planCreativeFetch({ ids: ["a"], transport: t, isolateCap: 0 });
    expect(r.objects.size).toBe(1);
    expect(r.telemetry.full_fetched).toBe(0);
    expect(r.telemetry.minimal_fetched).toBe(1);
    expect(r.telemetry.minimal_only).toBe(1);
    expect(r.minimalOnlyIds.has("a")).toBe(true);
    expect(r.telemetry.degraded).toBe(true);
    expect(r.telemetry.error_codes.map((e) => e.code)).toContain(100);
    expect(
      creativesStageOutcome({ attempted: 1, fetched: 1, minimalOnly: 1, failed: 0 }),
    ).toBe("degraded");
  });

  it("um creative problemático NÃO afeta os demais", async () => {
    const t = transport((id, fields) => {
      if (id === "BAD") return err(803, { type: "GraphBatchException" }); // falha sempre
      if (id === "MINONLY" && fields === CREATIVE_FIELDS_FULL) return err(100);
      return obj({ id });
    });
    const r = await planCreativeFetch({
      ids: ["ok1", "MINONLY", "BAD", "ok2"],
      transport: t,
      isolateCap: 0,
    });
    expect([...r.objects.keys()].sort()).toEqual(["MINONLY", "ok1", "ok2"]);
    expect(r.telemetry.full_fetched).toBe(2); // ok1, ok2
    expect(r.telemetry.minimal_only).toBe(1); // MINONLY
    expect(r.telemetry.failed).toBe(1);
    expect(r.telemetry.failed_ids).toEqual(["BAD"]);
  });

  it("61 FULL -> success; 60 FULL + 1 MINIMAL -> degraded; 1 failed -> degraded", async () => {
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
    // caso 1: todos FULL
    let t = transport((id) => obj({ id }));
    let r = await planCreativeFetch({ ids, transport: t });
    expect(creativesStageOutcome({ attempted: 61, fetched: r.objects.size, minimalOnly: r.telemetry.minimal_only, failed: r.telemetry.failed })).toBe("done");

    // caso 2: id30 só MINIMAL
    t = transport((id, f) => (id === "id30" && f === CREATIVE_FIELDS_FULL ? err(100) : obj({ id })));
    r = await planCreativeFetch({ ids, transport: t, isolateCap: 0 });
    expect(r.objects.size).toBe(61);
    expect(r.telemetry.minimal_only).toBe(1);
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, minimalOnly: 1, failed: 0 })).toBe("degraded");

    // caso 3: id30 falha total
    t = transport((id) => (id === "id30" ? err(803) : obj({ id })));
    r = await planCreativeFetch({ ids, transport: t, isolateCap: 0 });
    expect(r.objects.size).toBe(60);
    expect(r.telemetry.failed).toBe(1);
    expect(creativesStageOutcome({ attempted: 61, fetched: 60, minimalOnly: 0, failed: 1 })).toBe("degraded");
  });

  it("0 salvos -> stage error (nunca success)", async () => {
    const t = transport(() => err(10, { type: "OAuthException" }));
    const r = await planCreativeFetch({ ids: ["a", "b"], transport: t, isolateCap: 0 });
    expect(r.objects.size).toBe(0);
    expect(r.telemetry.failed).toBe(2);
    expect(
      creativesStageOutcome({ attempted: 2, fetched: 0, minimalOnly: 0, failed: 2 }),
    ).toBe("error");
  });

  it("token_revoked aborta imediatamente (sem MINIMAL, sem próximos ids)", async () => {
    const t = transport(() => err(190, { type: "OAuthException" }));
    const r = await planCreativeFetch({
      ids: ["a", "b", "c"],
      transport: t,
      isolateCap: 0,
    });
    expect(r.tokenRevoked).toBe(true);
    expect(r.objects.size).toBe(0);
    expect(t.calls).toHaveLength(1); // parou no 1º FULL
  });

  it("permission #10 / #100 / #803 NÃO são engolidos", async () => {
    for (const code of [10, 100, 803]) {
      const t = transport(() => err(code));
      const r = await planCreativeFetch({ ids: ["a"], transport: t, isolateCap: 0 });
      expect(r.telemetry.error_codes.map((e) => e.code)).toContain(code);
    }
  });

  it("callCap: além do teto, ids restantes viram failed", async () => {
    const t = transport((id) => obj({ id }));
    const r = await planCreativeFetch({
      ids: ["a", "b", "c", "d", "e"],
      transport: t,
      callCap: 3,
    });
    expect(t.calls.length).toBeLessThanOrEqual(3);
    expect(r.telemetry.failed).toBeGreaterThan(0);
  });
});

describe("isolateFailingFieldGroup — nomeia o field que quebra", () => {
  it("aponta o grupo problemático (ex.: asset_feed_spec)", async () => {
    const t = transport((_id, fields) =>
      has(fields, "asset_feed_spec") ? err(100, { type: "GraphMethodException" }) : obj({ ok: 1 }),
    );
    const r = await isolateFailingFieldGroup("x", t);
    expect(r.group).toBe("asset_feed_spec");
    expect(r.error?.failingFieldGroup).toBe("asset_feed_spec");
  });

  it("aponta object_story_spec quando é ele", async () => {
    const t = transport((_id, fields) =>
      has(fields, "object_story_spec") ? err(100) : obj({ ok: 1 }),
    );
    const r = await isolateFailingFieldGroup("x", t);
    expect(r.group).toBe("object_story_spec");
  });

  it("nenhum grupo isolado falha -> group null (não é problema de field)", async () => {
    const t = transport(() => obj({ ok: 1 }));
    const r = await isolateFailingFieldGroup("x", t);
    expect(r.group).toBeNull();
    expect(r.error).toBeNull();
  });

  it("nem id,name funciona -> group null (creative indisponível)", async () => {
    const t = transport(() => err(803));
    const r = await isolateFailingFieldGroup("x", t);
    expect(r.group).toBeNull();
    expect(r.error?.code).toBe(803);
    expect(r.calls).toBe(1);
  });

  it("planCreativeFetch roda o isolamento nos primeiros N que falham (isolateCap)", async () => {
    const t = transport((_id, fields) =>
      fields === CREATIVE_FIELDS_FULL
        ? err(100)
        : has(fields, "object_story_spec")
          ? err(100, { type: "GraphMethodException" })
          : obj({ ok: 1 }),
    );
    // FULL falha p/ todos; MINIMAL (sem specs) funciona -> minimal_only; isolamento nos 2 primeiros
    const r = await planCreativeFetch({
      ids: ["a", "b", "c", "d"],
      transport: t,
      isolateCap: 2,
    });
    expect(r.telemetry.minimal_only).toBe(4);
    const grp = r.telemetry.error_codes.find((e) => e.failingFieldGroup);
    expect(grp?.failingFieldGroup).toBe("object_story_spec");
  });
});

describe("sanitizeGraphError — só campos seguros, nunca token/message", () => {
  it("extrai code/subcode/type/user_title/fbtrace", () => {
    const s = sanitizeGraphError({
      error: {
        message: "token=secret_XYZ leaked",
        code: 100,
        error_subcode: 33,
        type: "GraphMethodException",
        error_user_title: "Campo inválido",
        fbtrace_id: "Tr1",
      },
    });
    expect(s).toMatchObject({
      code: 100,
      subcode: 33,
      type: "GraphMethodException",
      userTitle: "Campo inválido",
      fbtrace: "Tr1",
    });
    expect(JSON.stringify(s)).not.toContain("secret_XYZ");
  });
  it("sem error -> null; isTokenRevoked false", () => {
    const s = sanitizeGraphError(null);
    expect(s.code).toBeNull();
    expect(isTokenRevoked(s)).toBe(false);
  });
  it("190 e 102·463 são token_revoked", () => {
    expect(isTokenRevoked(sanitizeGraphError({ error: { code: 190 } }))).toBe(true);
    expect(
      isTokenRevoked(sanitizeGraphError({ error: { code: 102, error_subcode: 463 } })),
    ).toBe(true);
  });
});

describe("outcome dos stages", () => {
  it("creatives", () => {
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, minimalOnly: 0, failed: 0 })).toBe("done");
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, minimalOnly: 1, failed: 0 })).toBe("degraded");
    expect(creativesStageOutcome({ attempted: 61, fetched: 60, minimalOnly: 0, failed: 1 })).toBe("degraded");
    expect(creativesStageOutcome({ attempted: 61, fetched: 0, minimalOnly: 0, failed: 61 })).toBe("error");
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, minimalOnly: 0, failed: 0, fatal: true })).toBe("error");
    expect(creativesStageOutcome({ attempted: 0, fetched: 0, minimalOnly: 0, failed: 0 })).toBe("done");
  });
  it("ad_creatives", () => {
    expect(linkStageOutcome({ attempted: 95, linked: 95, skipped: 0 })).toBe("done");
    expect(linkStageOutcome({ attempted: 95, linked: 90, skipped: 5 })).toBe("degraded");
    expect(linkStageOutcome({ attempted: 95, linked: 0, skipped: 95 })).toBe("error");
  });
});

describe("planAdCreativeLinks — só liga creatives salvos (zero duplicação)", () => {
  const adRef = new Map([["a1", "r1"], ["a2", "r2"], ["a3", "r3"]]);
  it("pula par cujo creative não foi salvo ou ad não resolve", () => {
    const r = planAdCreativeLinks({
      pairs: [
        { adId: "a1", creativeId: "c1" },
        { adId: "a2", creativeId: "c2" }, // c2 não salvo
        { adId: "aX", creativeId: "c3" }, // ad sem ref
      ],
      adRefByMetaId: adRef,
      savedCreativeIds: new Set(["c1", "c3"]),
    });
    expect(r.links).toEqual([{ adId: "a1", creativeId: "c1", adRef: "r1" }]);
    expect(r.skipped).toBe(2);
    expect(r.attempted).toBe(3);
  });
  it("todos salvos -> 0 skipped -> done", () => {
    const r = planAdCreativeLinks({
      pairs: [{ adId: "a1", creativeId: "c1" }, { adId: "a2", creativeId: "c2" }],
      adRefByMetaId: adRef,
      savedCreativeIds: new Set(["c1", "c2"]),
    });
    expect(r.skipped).toBe(0);
    expect(linkStageOutcome({ attempted: r.attempted, linked: r.links.length, skipped: r.skipped })).toBe("done");
  });
});

describe("field-sets FULL / MINIMAL / grupos", () => {
  it("FULL contém os specs ricos; MINIMAL não", () => {
    expect(CREATIVE_FIELDS_FULL).toContain("object_story_spec");
    expect(CREATIVE_FIELDS_FULL).toContain("asset_feed_spec");
    expect(CREATIVE_FIELDS_MINIMAL).not.toContain("object_story_spec");
    expect(CREATIVE_FIELDS_MINIMAL).not.toContain("asset_feed_spec");
    expect(CREATIVE_FIELDS_MINIMAL).toContain("image_hash");
    expect(CREATIVE_FIELDS_MINIMAL).toContain("video_id");
  });
  it("grupos de isolamento cobrem os fields extra do FULL", () => {
    const grouped = new Set(CREATIVE_FIELD_GROUPS.flatMap((g) => g.fields));
    for (const f of CREATIVE_FIELDS_FULL.split(",")) {
      if (f === "id" || f === "name") continue;
      expect(grouped.has(f), f).toBe(true);
    }
  });
});
