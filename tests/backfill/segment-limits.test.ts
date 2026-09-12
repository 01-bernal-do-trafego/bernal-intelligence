import { describe, expect, it } from "vitest";
import { MAX_PLANNED_SEGMENTS, exceedsMaxPlannedSegments } from "../../scripts/backfill/segment-limits";

describe("MAX_PLANNED_SEGMENTS", () => {
  it("é 2000 — documentado, não um número pequeno arbitrário", () => {
    expect(MAX_PLANNED_SEGMENTS).toBe(2000);
  });
});

describe("exceedsMaxPlannedSegments", () => {
  it("abaixo do limite -> false", () => {
    expect(exceedsMaxPlannedSegments(1999)).toBe(false);
    expect(exceedsMaxPlannedSegments(2000)).toBe(false);
  });
  it("acima do limite -> true", () => {
    expect(exceedsMaxPlannedSegments(2001)).toBe(true);
  });
  it("aceita um limite customizado (para testes/ajuste)", () => {
    expect(exceedsMaxPlannedSegments(10, 5)).toBe(true);
    expect(exceedsMaxPlannedSegments(5, 5)).toBe(false);
  });
});
