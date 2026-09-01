import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  costPerResult,
  cpc,
  cpm,
  ctr,
  safeDivide,
  type DailyMetricRow,
} from "@/lib/metrics";

describe("safeDivide", () => {
  it("divides normally", () => {
    expect(safeDivide(10, 2)).toBe(5);
  });

  it("returns 0 instead of Infinity/NaN when the denominator is 0", () => {
    expect(safeDivide(10, 0)).toBe(0);
    expect(safeDivide(0, 0)).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(safeDivide(Number.NaN, 2)).toBe(0);
    expect(safeDivide(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("derived metrics — reference fixture", () => {
  // Investimento R$ 1.000 | Impressões 100.000 | Cliques 2.000 | Resultados 50
  const totals = { spend: 1000, impressions: 100_000, clicks: 2000, results: 50 };

  it("CTR = cliques / impressões * 100 = 2%", () => {
    expect(ctr(totals)).toBe(2);
  });

  it("CPC = investimento / cliques = R$ 0,50", () => {
    expect(cpc(totals)).toBe(0.5);
  });

  it("CPM = investimento / impressões * 1000 = R$ 10", () => {
    expect(cpm(totals)).toBe(10);
  });

  it("CPR = investimento / resultados = R$ 20", () => {
    expect(costPerResult(totals)).toBe(20);
  });
});

describe("aggregateMetrics", () => {
  it("soma totais brutos e calcula derivadas sobre eles (fixture)", () => {
    const rows: DailyMetricRow[] = [
      { date: "2026-01-01", spend: 400, impressions: 40_000, clicks: 800, results: 20, reach: 30_000 },
      { date: "2026-01-02", spend: 600, impressions: 60_000, clicks: 1200, results: 30, reach: 45_000 },
    ];

    const agg = aggregateMetrics(rows);

    expect(agg.spend).toBe(1000);
    expect(agg.impressions).toBe(100_000);
    expect(agg.clicks).toBe(2000);
    expect(agg.results).toBe(50);
    expect(agg.reach).toBe(75_000);
    expect(agg.ctr).toBe(2);
    expect(agg.cpc).toBe(0.5);
    expect(agg.cpm).toBe(10);
    expect(agg.cpr).toBe(20);
  });

  it("NUNCA faz média de métricas derivadas diárias", () => {
    // Dia 1: CTR 10% | Dia 2: CTR ~1,11% -> média ingênua ~5,56%
    // Correto: 20 cliques / 1000 impressões * 100 = 2%
    const rows: DailyMetricRow[] = [
      { date: "2026-01-01", spend: 50, impressions: 100, clicks: 10, results: 1, reach: 90 },
      { date: "2026-01-02", spend: 50, impressions: 900, clicks: 10, results: 1, reach: 800 },
    ];

    expect(aggregateMetrics(rows).ctr).toBe(2);
  });

  it("faixa vazia não produz NaN", () => {
    const agg = aggregateMetrics([]);
    expect(agg.ctr).toBe(0);
    expect(agg.cpc).toBe(0);
    expect(agg.cpm).toBe(0);
    expect(agg.cpr).toBe(0);
  });
});
