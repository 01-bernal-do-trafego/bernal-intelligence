import { describe, expect, it, vi } from "vitest";
import {
  CREATIVE_FIELDS_FULL,
  CREATIVE_FIELDS_MINIMAL,
  creativesStageOutcome,
  isTokenRevoked,
  linkStageOutcome,
  planAdCreativeLinks,
  planCreativeFetch,
  sanitizeGraphError,
  type CreativeTransport,
  type GraphFetchOutcome,
} from "@/lib/meta/creative-batch-fetch";

const ok = (objects: Record<string, unknown>): GraphFetchOutcome => ({ ok: true, objects });
const err = (
  code: number,
  extra: Partial<{ error_subcode: number; type: string; error_user_title: string; fbtrace_id: string }> = {},
): GraphFetchOutcome => ({
  ok: false,
  error: sanitizeGraphError({ error: { code, message: "x", ...extra } }),
});

/** transporte controlado por roteiros de resposta. */
function transport(routes: {
  batch?: (ids: string[], fields: string) => GraphFetchOutcome;
  single?: (id: string, fields: string) => GraphFetchOutcome;
}): CreativeTransport & { calls: { batch: unknown[][]; single: unknown[][] } } {
  const calls = { batch: [] as unknown[][], single: [] as unknown[][] };
  return {
    calls,
    batch: vi.fn(async (ids: string[], fields: string) => {
      calls.batch.push([ids, fields]);
      return routes.batch?.(ids, fields) ?? ok(Object.fromEntries(ids.map((i) => [i, { id: i }])));
    }),
    single: vi.fn(async (id: string, fields: string) => {
      calls.single.push([id, fields]);
      return routes.single?.(id, fields) ?? ok({ [id]: { id } });
    }),
  };
}

describe("planCreativeFetch — camadas A/B/C", () => {
  it("A: full batch success -> tudo cheio, sem degradar", async () => {
    const t = transport({});
    const r = await planCreativeFetch({ ids: ["1", "2", "3"], transport: t });
    expect(r.objects.size).toBe(3);
    expect(r.telemetry.full_fetched).toBe(3);
    expect(r.telemetry.fallback_fetched).toBe(0);
    expect(r.telemetry.degraded).toBe(false);
    expect(r.telemetry.failed).toBe(0);
    expect(t.calls.batch[0][1]).toBe(CREATIVE_FIELDS_FULL);
    expect(t.calls.single).toHaveLength(0);
  });

  it("B: full fields error (#100) + minimal batch success -> degraded, sem per-id", async () => {
    const t = transport({
      batch: (_ids, fields) =>
        fields === CREATIVE_FIELDS_FULL ? err(100, { type: "GraphMethodException" }) : ok({ a: { id: "a" }, b: { id: "b" } }),
    });
    const r = await planCreativeFetch({ ids: ["a", "b"], transport: t });
    expect(r.objects.size).toBe(2);
    expect(r.telemetry.minimal_fields_used).toBe(true);
    expect(r.telemetry.per_id_fallback_used).toBe(false);
    expect(r.telemetry.degraded).toBe(true);
    expect(r.telemetry.full_fetched).toBe(0);
    expect(r.telemetry.fallback_fetched).toBe(2);
    expect(r.telemetry.error_codes.map((e) => e.code)).toContain(100);
    expect(t.calls.batch[1][1]).toBe(CREATIVE_FIELDS_MINIMAL);
  });

  it("C: os dois batches falham + per-id success -> per_id_fallback_used", async () => {
    const t = transport({
      batch: () => err(3, { type: "GraphMethodException" }), // Unsupported get
      single: (id) => ok({ [id]: { id } }),
    });
    const r = await planCreativeFetch({ ids: ["a", "b"], transport: t });
    expect(r.objects.size).toBe(2);
    expect(r.telemetry.per_id_fallback_used).toBe(true);
    expect(r.telemetry.degraded).toBe(true);
    expect(t.calls.single).toHaveLength(2);
  });

  it("1 id inválido não elimina os outros do chunk (per-id)", async () => {
    const t = transport({
      batch: () => err(803, { type: "GraphBatchException" }),
      single: (id) => (id === "BAD" ? err(803) : ok({ [id]: { id } })),
    });
    const r = await planCreativeFetch({ ids: ["ok1", "BAD", "ok2"], transport: t });
    expect(r.objects.size).toBe(2);
    expect([...r.objects.keys()].sort()).toEqual(["ok1", "ok2"]);
    expect(r.telemetry.failed).toBe(1);
    expect(r.telemetry.failed_ids).toEqual(["BAD"]);
    expect(r.telemetry.error_codes.map((e) => e.code)).toContain(803);
  });

  it("token_revoked no batch A aborta imediatamente (sem B nem C nem próximo chunk)", async () => {
    const t = transport({ batch: () => err(190, { type: "OAuthException" }) });
    const r = await planCreativeFetch({
      ids: Array.from({ length: 120 }, (_, i) => `c${i}`),
      transport: t,
      chunkSize: 50,
    });
    expect(r.tokenRevoked).toBe(true);
    expect(r.objects.size).toBe(0);
    expect(t.calls.batch).toHaveLength(1); // parou no 1º chunk / 1ª tentativa
    expect(t.calls.single).toHaveLength(0);
  });

  it("token_revoked por subcode 102·463 também aborta", async () => {
    const t = transport({ batch: () => err(102, { error_subcode: 463 }) });
    const r = await planCreativeFetch({ ids: ["a"], transport: t });
    expect(r.tokenRevoked).toBe(true);
  });

  it("permission error (#10) NÃO é engolido — vai para error_codes", async () => {
    const t = transport({ batch: () => err(10, { type: "OAuthException", error_user_title: "Permissões" }), single: () => err(10) });
    const r = await planCreativeFetch({ ids: ["a"], transport: t });
    expect(r.tokenRevoked).toBe(false);
    expect(r.objects.size).toBe(0);
    expect(r.telemetry.error_codes[0]).toMatchObject({ code: 10, userTitle: "Permissões" });
  });

  it("#100 e #803 aparecem em error_codes (não silenciados)", async () => {
    for (const code of [100, 803]) {
      const t = transport({ batch: () => err(code), single: () => err(code) });
      const r = await planCreativeFetch({ ids: ["a"], transport: t });
      expect(r.telemetry.error_codes.map((e) => e.code)).toContain(code);
    }
  });

  it("attempted=61 fetched=0 -> telemetria reflete falha total (stage vira error)", async () => {
    const t = transport({ batch: () => err(10), single: () => err(10) });
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
    const r = await planCreativeFetch({ ids, transport: t });
    expect(r.telemetry.attempted).toBe(61);
    expect(r.objects.size).toBe(0);
    expect(r.telemetry.failed).toBe(61);
    expect(
      creativesStageOutcome({ attempted: 61, fetched: 0, degraded: true, failed: 61 }),
    ).toBe("error");
  });

  it("fetch parcial (60 de 61) -> failed=1, degraded", async () => {
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
    const t = transport({
      batch: () => err(3),
      single: (id) => (id === "id7" ? err(803) : ok({ [id]: { id } })),
    });
    const r = await planCreativeFetch({ ids, transport: t });
    expect(r.objects.size).toBe(60);
    expect(r.telemetry.failed).toBe(1);
    expect(r.telemetry.degraded).toBe(true);
  });

  it("perIdCap respeitado — resto vira failed", async () => {
    const t = transport({ batch: () => err(3), single: (id) => ok({ [id]: { id } }) });
    const r = await planCreativeFetch({
      ids: ["a", "b", "c", "d", "e"],
      transport: t,
      perIdCap: 2,
    });
    expect(t.calls.single).toHaveLength(2);
    expect(r.objects.size).toBe(2);
    expect(r.telemetry.failed).toBe(3);
  });

  it("chunking: >50 ids -> vários chunks", async () => {
    const t = transport({});
    const r = await planCreativeFetch({
      ids: Array.from({ length: 61 }, (_, i) => `id${i}`),
      transport: t,
    });
    expect(r.telemetry.chunks).toBe(2);
    expect(r.objects.size).toBe(61);
  });
});

describe("sanitizeGraphError — só campos seguros, nunca token", () => {
  it("extrai code/subcode/type/user_title/fbtrace", () => {
    const s = sanitizeGraphError({
      error: {
        message: "Invalid OAuth access token secret_ABC123",
        code: 190,
        error_subcode: 463,
        type: "OAuthException",
        error_user_title: "Sessão expirada",
        fbtrace_id: "AbC",
      },
    });
    expect(s).toEqual({
      code: 190,
      subcode: 463,
      type: "OAuthException",
      userTitle: "Sessão expirada",
      fbtrace: "AbC",
    });
    // nada da `message` (que poderia ter credencial) vaza
    expect(JSON.stringify(s)).not.toContain("secret_ABC123");
    expect(Object.keys(s).sort()).toEqual(["code", "fbtrace", "subcode", "type", "userTitle"]);
  });

  it("corpo sem error -> tudo null, isTokenRevoked=false", () => {
    const s = sanitizeGraphError(null);
    expect(s).toEqual({ code: null, subcode: null, type: null, userTitle: null, fbtrace: null });
    expect(isTokenRevoked(s)).toBe(false);
  });
});

describe("outcome dos stages (success/partial/error)", () => {
  it("creatives: tudo cheio -> done", () => {
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, degraded: false, failed: 0 })).toBe("done");
  });
  it("creatives: parcial/fallback -> degraded (=> run partial)", () => {
    expect(creativesStageOutcome({ attempted: 61, fetched: 60, degraded: true, failed: 1 })).toBe("degraded");
  });
  it("creatives: 0 de N -> error (=> run partial, NUNCA success)", () => {
    expect(creativesStageOutcome({ attempted: 61, fetched: 0, degraded: true, failed: 61 })).toBe("error");
  });
  it("creatives: fatal -> error", () => {
    expect(creativesStageOutcome({ attempted: 61, fetched: 61, degraded: false, failed: 0, fatal: true })).toBe("error");
  });
  it("creatives: 0 esperado -> done", () => {
    expect(creativesStageOutcome({ attempted: 0, fetched: 0, degraded: false, failed: 0 })).toBe("done");
  });
  it("ad_creatives: ligou tudo -> done; pulou -> degraded; 0 -> error", () => {
    expect(linkStageOutcome({ attempted: 95, linked: 95, skipped: 0 })).toBe("done");
    expect(linkStageOutcome({ attempted: 95, linked: 90, skipped: 5 })).toBe("degraded");
    expect(linkStageOutcome({ attempted: 95, linked: 0, skipped: 95 })).toBe("error");
  });
});

describe("planAdCreativeLinks — só liga creatives REALMENTE salvos", () => {
  const pairs = [
    { adId: "a1", creativeId: "c1" },
    { adId: "a2", creativeId: "c2" }, // c2 não salvo
    { adId: "a3", creativeId: "c3" }, // a3 sem ref
  ];
  const adRef = new Map([
    ["a1", "ref-a1"],
    ["a2", "ref-a2"],
  ]);

  it("pula par cujo creative não foi salvo e par cujo ad não resolve", () => {
    const r = planAdCreativeLinks({
      pairs,
      adRefByMetaId: adRef,
      savedCreativeIds: new Set(["c1"]),
    });
    expect(r.attempted).toBe(3);
    expect(r.links).toEqual([{ adId: "a1", creativeId: "c1", adRef: "ref-a1" }]);
    expect(r.skipped).toBe(2);
  });

  it("todos salvos -> 0 skipped", () => {
    const r = planAdCreativeLinks({
      pairs: [pairs[0], pairs[1]],
      adRefByMetaId: adRef,
      savedCreativeIds: new Set(["c1", "c2"]),
    });
    expect(r.links).toHaveLength(2);
    expect(r.skipped).toBe(0);
  });

  it("nenhum creative salvo -> tudo skipped (=> stage error via linkStageOutcome)", () => {
    const r = planAdCreativeLinks({ pairs, adRefByMetaId: adRef, savedCreativeIds: new Set() });
    expect(r.links).toHaveLength(0);
    expect(r.skipped).toBe(3);
    expect(linkStageOutcome({ attempted: r.attempted, linked: 0, skipped: r.skipped })).toBe("error");
  });
});
