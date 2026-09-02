import { describe, expect, it } from "vitest";
import { computeMetric, emptyTotals, type MetricTotals } from "@/lib/metrics/compute";
import { cpc, cpm, ctr, costPerResult } from "@/lib/metrics";

// Fixture de referência (mesma do teste de lib/metrics):
// Investimento R$ 1.000 | Impressões 100.000 | Cliques 2.000 | Resultados 50
function totals(overrides: Partial<MetricTotals> = {}): MetricTotals {
  return {
    ...emptyTotals(),
    spend: 1000,
    impressions: 100_000,
    clicks: 2000,
    reach: 80_000,
    inline_link_clicks: 1500,
    actions: { results: 50, leads: 50, purchases: 10 },
    actionValues: { revenue: 4000 },
    ...overrides,
  };
}

describe("computeMetric — colunas nativas", () => {
  it("lê a coluna direta", () => {
    expect(computeMetric("spend", totals())).toBe(1000);
    expect(computeMetric("impressions", totals())).toBe(100_000);
    expect(computeMetric("investment", totals())).toBe(1000); // alias -> spend
  });
  it("coluna ausente -> null (não 0)", () => {
    expect(computeMetric("clicks", totals({ clicks: null }))).toBeNull();
  });
});

describe("computeMetric — conversões (actions)", () => {
  it("lê do bag de actions / actionValues", () => {
    expect(computeMetric("results", totals())).toBe(50);
    expect(computeMetric("leads", totals())).toBe(50);
    expect(computeMetric("purchases", totals())).toBe(10);
    expect(computeMetric("revenue", totals())).toBe(4000);
  });
  it("conversão sem fonte -> null", () => {
    expect(computeMetric("conversations", totals())).toBeNull();
  });
});

describe("computeMetric — fórmulas sobre TOTAIS BRUTOS", () => {
  it("CTR = cliques / impressões * 100", () => {
    expect(computeMetric("ctr", totals())).toBe(2);
    expect(computeMetric("ctr", totals())).toBe(ctr({ clicks: 2000, impressions: 100_000 }));
  });
  it("CPC = investimento / cliques", () => {
    expect(computeMetric("cpc", totals())).toBe(0.5);
    expect(computeMetric("cpc", totals())).toBe(cpc({ spend: 1000, clicks: 2000 }));
  });
  it("CPM = investimento / impressões * 1000", () => {
    expect(computeMetric("cpm", totals())).toBe(10);
    expect(computeMetric("cpm", totals())).toBe(cpm({ spend: 1000, impressions: 100_000 }));
  });
  it("Custo por resultado = investimento / resultados", () => {
    expect(computeMetric("cost_per_result", totals())).toBe(20);
    expect(computeMetric("cost_per_result", totals())).toBe(
      costPerResult({ spend: 1000, results: 50 }),
    );
  });
  it("CPA = investimento / compras", () => {
    expect(computeMetric("cpa", totals())).toBe(100);
  });
  it("ROAS = receita / investimento", () => {
    expect(computeMetric("roas", totals())).toBe(4);
  });
  it("Frequência = impressões / alcance", () => {
    expect(computeMetric("frequency", totals())).toBe(1.25);
  });
});

describe("computeMetric — proteção", () => {
  it("divisão por zero -> 0 (safeDivide), não NaN/Infinity", () => {
    expect(computeMetric("cpc", totals({ clicks: 0 }))).toBe(0);
    expect(computeMetric("ctr", totals({ impressions: 0 }))).toBe(0);
  });
  it("numerador/denominador ausente -> null (propaga a ausência)", () => {
    expect(computeMetric("roas", totals({ actionValues: {} }))).toBeNull();
    expect(computeMetric("cost_per_result", totals({ actions: {} }))).toBeNull();
  });
  it("nunca calcula média de métrica derivada — só recebe TOTAIS", () => {
    // dois dias: dia1 CTR 10%, dia2 CTR ~1,11%; média ingênua ~5,56%.
    // Correto sobre totais: 20 / 1000 * 100 = 2%.
    const combined = totals({ clicks: 20, impressions: 1000 });
    expect(computeMetric("ctr", combined)).toBe(2);
  });
  it("métrica inexistente -> null", () => {
    expect(computeMetric("nao_existe", totals())).toBeNull();
  });
});
