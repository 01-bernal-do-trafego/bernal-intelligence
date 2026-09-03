import { describe, expect, it } from "vitest";
import {
  creativeIdsNeedingFull,
  detailsFetchedAtFor,
} from "@/lib/meta/creative-incremental";

const NOW = Date.parse("2026-09-03T12:00:00Z");
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

describe("creativeIdsNeedingFull — FULL só p/ novo / stale / sem detalhe", () => {
  it("creative NOVO (não conhecido) -> precisa FULL", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["c_new"],
      known: new Map(),
      now: NOW,
    });
    expect(out).toEqual(["c_new"]);
  });

  it("creative conhecido e FULL FRESCO (<24h) -> NÃO refaz", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["c1"],
      known: new Map([["c1", { detailsFetchedAt: h(3) }]]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it("creative conhecido mas STALE (>24h) -> refaz", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["c1"],
      known: new Map([["c1", { detailsFetchedAt: h(30) }]]),
      now: NOW,
    });
    expect(out).toEqual(["c1"]);
  });

  it("creative INCOMPLETO (details_fetched_at NULL — salvo só via MINIMAL) -> refaz", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["c1"],
      known: new Map([["c1", { detailsFetchedAt: null }]]),
      now: NOW,
    });
    expect(out).toEqual(["c1"]);
  });

  it("mistura: só os que precisam", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["fresh", "stale", "minimal", "new", "fresh"],
      known: new Map([
        ["fresh", { detailsFetchedAt: h(1) }],
        ["stale", { detailsFetchedAt: h(48) }],
        ["minimal", { detailsFetchedAt: null }],
      ]),
      now: NOW,
    });
    expect(out.sort()).toEqual(["minimal", "new", "stale"]);
  });

  it("um sync de rotina (todos frescos) -> 0 chamadas FULL", () => {
    const known = new Map(
      Array.from({ length: 61 }, (_, i) => [`c${i}`, { detailsFetchedAt: h(2) }]),
    );
    const out = creativeIdsNeedingFull({
      referenced: [...known.keys()],
      known,
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it("aceita Record além de Map; ignora ids vazios/duplicados", () => {
    const out = creativeIdsNeedingFull({
      referenced: ["a", "a", "", "b"],
      known: { a: { detailsFetchedAt: h(1) } },
      now: NOW,
    });
    expect(out).toEqual(["b"]);
  });
});

describe("detailsFetchedAtFor — FULL marca; MINIMAL preserva (não rebaixa)", () => {
  const nowIso = new Date(NOW).toISOString();
  it("veio FULL -> nowIso", () => {
    expect(detailsFetchedAtFor("c1", false, new Map(), nowIso)).toBe(nowIso);
  });
  it("veio só MINIMAL, já era FULL -> mantém o timestamp antigo", () => {
    expect(
      detailsFetchedAtFor("c1", true, new Map([["c1", h(10)]]), nowIso),
    ).toBe(h(10));
  });
  it("veio só MINIMAL, era novo -> null (retenta no próximo ciclo)", () => {
    expect(detailsFetchedAtFor("c_new", true, new Map(), nowIso)).toBeNull();
  });
});
