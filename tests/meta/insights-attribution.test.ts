/**
 * Prioridade determinística de attribution_window (lib/meta/insights-attribution.ts).
 * NUNCA somar unified + legado da mesma conta/data/intervalo.
 */
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_PRIORITY,
  dedupeByAttribution,
  pickByAttributionPriority,
} from "@/lib/meta/insights-attribution";

describe("pickByAttributionPriority", () => {
  it("unified vence legado, independente da ordem de entrada", () => {
    const a = pickByAttributionPriority([
      { attribution_window: "7d_click_1d_view", v: 1 },
      { attribution_window: "unified_attribution", v: 2 },
    ]);
    const b = pickByAttributionPriority([
      { attribution_window: "unified_attribution", v: 2 },
      { attribution_window: "7d_click_1d_view", v: 1 },
    ]);
    expect(a?.v).toBe(2);
    expect(b?.v).toBe(2);
  });
  it("legado só quando não há unified", () => {
    expect(
      pickByAttributionPriority([{ attribution_window: "7d_click_1d_view", v: 9 }])?.v,
    ).toBe(9);
  });
  it("vazio -> null", () => {
    expect(pickByAttributionPriority([])).toBeNull();
  });
  it("prioridade documentada: unified primeiro", () => {
    expect(ATTRIBUTION_PRIORITY[0]).toBe("unified_attribution");
    expect(ATTRIBUTION_PRIORITY[1]).toBe("7d_click_1d_view");
  });
});

describe("dedupeByAttribution — mesma conta/data unified + legado", () => {
  const rows = [
    { entity_id: "act_1", date: "2026-09-01", attribution_window: "unified_attribution", spend: 100 },
    { entity_id: "act_1", date: "2026-09-01", attribution_window: "7d_click_1d_view", spend: 40 },
    { entity_id: "act_1", date: "2026-09-02", attribution_window: "unified_attribution", spend: 80 },
    { entity_id: "act_2", date: "2026-09-01", attribution_window: "7d_click_1d_view", spend: 30 },
  ];

  it("mesma (conta,data) com unified + legado -> só unified entra (nunca soma as duas)", () => {
    const out = dedupeByAttribution(rows, (r) => `${r.entity_id}|${r.date}`);
    // act_1|2026-09-01 deve resolver para o spend 100 (unified), não 140
    const sameKey = out.filter((r) => r.entity_id === "act_1" && r.date === "2026-09-01");
    expect(sameKey).toHaveLength(1);
    expect(sameKey[0].spend).toBe(100);
    // soma total do agregado não pode contar os 40 do legado
    expect(out.reduce((s, r) => s + r.spend, 0)).toBe(100 + 80 + 30);
  });

  it("act_2 só tinha legado -> mantém legado", () => {
    const out = dedupeByAttribution(rows, (r) => `${r.entity_id}|${r.date}`);
    const act2 = out.find((r) => r.entity_id === "act_2");
    expect(act2?.spend).toBe(30);
  });

  it("sem duplicatas -> devolve tudo (no-op)", () => {
    const clean = [
      { entity_id: "act_1", date: "d1", attribution_window: "unified_attribution", spend: 1 },
      { entity_id: "act_1", date: "d2", attribution_window: "unified_attribution", spend: 2 },
    ];
    expect(dedupeByAttribution(clean, (r) => `${r.entity_id}|${r.date}`)).toHaveLength(2);
  });
});
