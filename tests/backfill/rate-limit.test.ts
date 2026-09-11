import { describe, expect, it } from "vitest";
import { canRunBackfill, DEFAULT_BACKFILL_RATE_THRESHOLDS } from "@/lib/backfill/rate-limit";

describe("13. rate-limit contract — canRunBackfill", () => {
  it("sem snapshot ainda -> otimista, permite", () => {
    expect(canRunBackfill(null)).toBe(true);
  });

  it("throttled=true sempre bloqueia, mesmo com % baixos", () => {
    expect(
      canRunBackfill({ appUsagePct: 1, adAccountUsagePct: 1, bucUsagePct: 1, throttled: true }),
    ).toBe(false);
  });

  it("abaixo dos limiares -> permite", () => {
    expect(
      canRunBackfill({ appUsagePct: 10, adAccountUsagePct: 10, bucUsagePct: 10, throttled: false }),
    ).toBe(true);
  });

  it("app usage no/acima do limiar -> bloqueia", () => {
    expect(
      canRunBackfill({
        appUsagePct: DEFAULT_BACKFILL_RATE_THRESHOLDS.maxAppUsagePct,
        adAccountUsagePct: 10,
        bucUsagePct: 10,
        throttled: false,
      }),
    ).toBe(false);
  });

  it("ad account usage no/acima do limiar -> bloqueia", () => {
    expect(
      canRunBackfill({
        appUsagePct: 10,
        adAccountUsagePct: DEFAULT_BACKFILL_RATE_THRESHOLDS.maxAdAccountUsagePct,
        bucUsagePct: 10,
        throttled: false,
      }),
    ).toBe(false);
  });

  it("limiares customizados são respeitados", () => {
    const strict = { maxAppUsagePct: 10, maxAdAccountUsagePct: 10 };
    expect(
      canRunBackfill({ appUsagePct: 15, adAccountUsagePct: 5, bucUsagePct: 0, throttled: false }, strict),
    ).toBe(false);
  });
});
