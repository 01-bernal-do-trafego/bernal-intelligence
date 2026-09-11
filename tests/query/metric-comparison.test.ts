import { describe, expect, it } from "vitest";
import {
  compareMetricValues,
  resolveMetricComparison,
} from "@/lib/query/metric-comparison";
import { emptyDataQuality, type DataQuality } from "@/lib/data-quality";

const OK: DataQuality = { ...emptyDataQuality(), state: "ok", reasons: [] };

describe("compareMetricValues", () => {
  it("caso normal: delta absoluto e percentual", () => {
    const out = compareMetricValues(150, 100);
    expect(out.current).toBe(150);
    expect(out.previous).toBe(100);
    expect(out.deltaAbs).toBe(50);
    expect(out.deltaPct).toBeCloseTo(50, 10);
  });

  it("20. previous = 0 -> deltaPct null, NUNCA Infinity", () => {
    const out = compareMetricValues(100, 0);
    expect(out.deltaAbs).toBe(100);
    expect(out.deltaPct).toBe(null);
    expect(out.deltaPct).not.toBe(Infinity);
  });

  it("current = 0 e previous = 0 -> deltaAbs 0, deltaPct null", () => {
    const out = compareMetricValues(0, 0);
    expect(out.deltaAbs).toBe(0);
    expect(out.deltaPct).toBe(null);
  });

  it("previous null -> delta null (não lança, não assume 0)", () => {
    const out = compareMetricValues(100, null);
    expect(out.current).toBe(100);
    expect(out.previous).toBe(null);
    expect(out.deltaAbs).toBe(null);
    expect(out.deltaPct).toBe(null);
  });

  it("current null -> delta null", () => {
    const out = compareMetricValues(null, 100);
    expect(out.deltaAbs).toBe(null);
    expect(out.deltaPct).toBe(null);
  });

  it("ambos null -> delta null", () => {
    const out = compareMetricValues(null, null);
    expect(out.deltaAbs).toBe(null);
    expect(out.deltaPct).toBe(null);
  });

  it("queda: deltaPct negativo", () => {
    const out = compareMetricValues(80, 100);
    expect(out.deltaAbs).toBe(-20);
    expect(out.deltaPct).toBeCloseTo(-20, 10);
  });
});

describe("resolveMetricComparison", () => {
  it("combina por metricId", () => {
    const current = [
      { metricId: "spend", value: 300, quality: OK },
      { metricId: "leads", value: 10, quality: OK },
    ];
    const previous = [
      { metricId: "spend", value: 200, quality: OK },
      { metricId: "leads", value: 5, quality: OK },
    ];
    const out = resolveMetricComparison(current, previous);
    const spend = out.find((r) => r.metricId === "spend")!;
    expect(spend.current).toBe(300);
    expect(spend.previous).toBe(200);
    expect(spend.deltaAbs).toBe(100);
    const leads = out.find((r) => r.metricId === "leads")!;
    expect(leads.deltaAbs).toBe(5);
  });

  it("métrica ausente no período anterior -> previous null (não 0)", () => {
    const current = [{ metricId: "roas", value: 3, quality: OK }];
    const previous: typeof current = [];
    const out = resolveMetricComparison(current, previous);
    expect(out[0].previous).toBe(null);
    expect(out[0].deltaAbs).toBe(null);
  });
});
