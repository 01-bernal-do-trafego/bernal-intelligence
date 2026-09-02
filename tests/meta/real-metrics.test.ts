import { describe, expect, it } from "vitest";
import {
  buildRealTotals,
  isRealMetricAvailableThisPhase,
  reachIsConsolidable,
  realMetricValue,
  sumDailyAdditive,
  toRegistryMetricId,
  type DailyInsightLike,
} from "@/lib/meta/real-metrics";

const day = (over: Partial<DailyInsightLike> = {}): DailyInsightLike => ({
  date: "2026-09-01",
  spend: 100,
  impressions: 10000,
  clicks: 200,
  inlineLinkClicks: 150,
  reach: 8000,
  frequency: 1.25,
  ...over,
});

describe("sumDailyAdditive — reach/frequency NUNCA somados", () => {
  const rows = [
    day({ date: "2026-09-01", spend: 100, impressions: 10000, clicks: 200, inlineLinkClicks: 150, reach: 8000 }),
    day({ date: "2026-09-02", spend: 50, impressions: 6000, clicks: 120, inlineLinkClicks: 90, reach: 7000 }),
  ];

  it("soma só as aditivas", () => {
    expect(sumDailyAdditive(rows)).toEqual({
      spend: 150,
      impressions: 16000,
      clicks: 320,
      inlineLinkClicks: 240,
    });
  });

  it("não devolve reach nem frequency", () => {
    const out = sumDailyAdditive(rows) as unknown as Record<string, unknown>;
    expect("reach" in out).toBe(false);
    expect("frequency" in out).toBe(false);
  });

  it("null quando nenhuma linha tem o campo (ausência ≠ 0)", () => {
    expect(
      sumDailyAdditive([{ date: "d", spend: null, impressions: null, clicks: 5, reach: null, frequency: null }]).spend,
    ).toBeNull();
  });
});

describe("buildRealTotals", () => {
  it("aditivas da soma diária; reach/frequency SÓ do agregado periódico", () => {
    const t = buildRealTotals(
      { spend: 150, impressions: 16000, clicks: 320, inlineLinkClicks: 240 },
      { reach: 9000, frequency: 1.78 },
    );
    expect(t.spend).toBe(150);
    expect(t.reach).toBe(9000);
    expect(t.frequency).toBe(1.78);
  });

  it("sem agregado periódico => reach/frequency null (não aproxima)", () => {
    const t = buildRealTotals(
      { spend: 150, impressions: 16000, clicks: 320, inlineLinkClicks: 240 },
      null,
    );
    expect(t.reach).toBeNull();
    expect(t.frequency).toBeNull();
  });
});

describe("realMetricValue — derivadas sobre TOTAIS BRUTOS", () => {
  const totals = buildRealTotals(
    { spend: 150, impressions: 16000, clicks: 320, inlineLinkClicks: 240 },
    { reach: 8000, frequency: 2 },
  );

  it("CTR = cliques/impressões do período (não média de CTR diário)", () => {
    expect(realMetricValue("ctr", totals)).toBeCloseTo((320 / 16000) * 100, 6);
  });
  it("CPC = investimento/cliques", () => {
    expect(realMetricValue("cpc", totals)).toBeCloseTo(150 / 320, 6);
  });
  it("CPM = investimento/impressões * 1000", () => {
    expect(realMetricValue("cpm", totals)).toBeCloseTo((150 / 16000) * 1000, 6);
  });
  it("frequency = impressões/alcance do agregado", () => {
    expect(realMetricValue("frequency", totals)).toBeCloseTo(2, 6);
  });
  it("investment mapeia para spend", () => {
    expect(toRegistryMetricId("investment")).toBe("spend");
    expect(realMetricValue("investment", totals)).toBe(150);
  });
  it("gráfico diário: cada ponto recalculado sobre os totais DO DIA", () => {
    const d1 = buildRealTotals({ spend: 100, impressions: 10000, clicks: 200, inlineLinkClicks: 150 }, null);
    const d2 = buildRealTotals({ spend: 50, impressions: 5000, clicks: 50, inlineLinkClicks: 30 }, null);
    expect(realMetricValue("ctr", d1)).toBeCloseTo(2, 6);
    expect(realMetricValue("ctr", d2)).toBeCloseTo(1, 6);
  });
  it("denominador zerado => null (nunca NaN/0 forçado)", () => {
    const empty = buildRealTotals({ spend: 10, impressions: null, clicks: null, inlineLinkClicks: null }, null);
    expect(realMetricValue("ctr", empty)).toBeNull();
    expect(realMetricValue("cpc", empty)).toBeNull();
  });
});

describe("reachIsConsolidable — múltiplas contas", () => {
  it("conta única ou campanha => sempre consolidável", () => {
    expect(reachIsConsolidable({ scope: "account", linkedAccountCount: 3 })).toBe(true);
    expect(reachIsConsolidable({ scope: "campaign", linkedAccountCount: 3 })).toBe(true);
  });
  it('"todas as contas" com 1 conta vinculada => consolidável', () => {
    expect(reachIsConsolidable({ scope: "all", linkedAccountCount: 1 })).toBe(true);
    expect(reachIsConsolidable({ scope: "all", linkedAccountCount: 0 })).toBe(true);
  });
  it('"todas as contas" com >1 conta => NÃO consolidável (risco de dupla contagem de pessoas)', () => {
    expect(reachIsConsolidable({ scope: "all", linkedAccountCount: 2 })).toBe(false);
  });
});

describe("isRealMetricAvailableThisPhase — conversões fora desta fase", () => {
  it("liberadas", () => {
    for (const k of ["investment", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm"]) {
      expect(isRealMetricAvailableThisPhase(k)).toBe(true);
    }
  });
  it("bloqueadas (validação própria)", () => {
    for (const k of ["results", "cost_per_result", "purchases", "leads", "cpa", "roas", "revenue", "conversations"]) {
      expect(isRealMetricAvailableThisPhase(k)).toBe(false);
    }
  });
});
