import { describe, expect, it } from "vitest";
import { resolveMetricSeries } from "@/lib/query/metric-series";
import { SCOPE_SINGLE, dailyRow, scopeWith } from "./fixtures";

const RANGE = { from: "2026-09-01", to: "2026-09-03" };

function point(result: ReturnType<typeof resolveMetricSeries>, date: string) {
  const p = result.points.find((x) => x.date === date);
  if (!p) throw new Error(`ponto ${date} não encontrado`);
  return p.values;
}

describe("resolveMetricSeries — additive por dia", () => {
  it("valor diário = soma das entidades do escopo naquele dia (não o total do range)", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", spend: 100 }),
        dailyRow({ date: "2026-09-02", spend: 200 }),
        dailyRow({ date: "2026-09-03", spend: 300 }),
      ],
    });
    expect(point(out, "2026-09-01").spend).toBe(100);
    expect(point(out, "2026-09-02").spend).toBe(200);
    expect(point(out, "2026-09-03").spend).toBe(300);
  });

  it("soma entre entidades do escopo no mesmo dia", () => {
    const scope = scopeWith(["act_1", "act_2"]);
    const out = resolveMetricSeries({
      scope,
      range: { from: "2026-09-01", to: "2026-09-01" },
      metricIds: ["spend"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", entity_id: "act_1", spend: 100 }),
        dailyRow({ date: "2026-09-01", entity_id: "act_2", spend: 50 }),
      ],
    });
    expect(point(out, "2026-09-01").spend).toBe(150);
  });
});

describe("12. ratio é RECALCULADO por dia (não é média das taxas)", () => {
  it("CTR do dia = clicks do dia / impressions do dia", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["ctr"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", clicks: 10, impressions: 1000 }), // 1%
        dailyRow({ date: "2026-09-02", clicks: 30, impressions: 2000 }), // 1.5%
      ],
    });
    expect(point(out, "2026-09-01").ctr).toBeCloseTo(1, 10);
    expect(point(out, "2026-09-02").ctr).toBeCloseTo(1.5, 10);
  });
});

describe("11. reach diário pode existir como valor daquele DIA (não é total de período)", () => {
  it("escopo de 1 entidade -> reach do dia = valor nativo da linha", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["reach"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", reach: 1000 }),
        dailyRow({ date: "2026-09-02", reach: 900 }),
      ],
    });
    expect(point(out, "2026-09-01").reach).toBe(1000);
    expect(point(out, "2026-09-02").reach).toBe(900);
  });

  it("mas a série NUNCA vira total multi-dia por soma (isso é resolveMetricTotals, não aqui)", () => {
    // a própria série não expõe nenhum "total" — cada ponto é isolado.
    // este teste documenta a garantia: nenhum ponto é a soma de reach de dias anteriores.
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["reach"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", reach: 1000 }),
        dailyRow({ date: "2026-09-02", reach: 900 }),
        dailyRow({ date: "2026-09-03", reach: 950 }),
      ],
    });
    expect(point(out, "2026-09-03").reach).toBe(950);
    expect(point(out, "2026-09-03").reach).not.toBe(1000 + 900 + 950);
  });

  it("escopo multi-entidade -> reach diário indisponível (não existe reach diário combinado)", () => {
    const scope = scopeWith(["act_1", "act_2"]);
    const out = resolveMetricSeries({
      scope,
      range: { from: "2026-09-01", to: "2026-09-01" },
      metricIds: ["reach"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", entity_id: "act_1", reach: 1000 }),
        dailyRow({ date: "2026-09-01", entity_id: "act_2", reach: 800 }),
      ],
    });
    expect(point(out, "2026-09-01").reach).toBe(null);
  });
});

describe("13-14. zero vs ausência na série", () => {
  it("dia sem nenhuma linha -> null em toda métrica (não 0)", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend", "leads"],
      dailyRows: [dailyRow({ date: "2026-09-02", spend: 100 })], // só dia 2 tem linha
    });
    expect(point(out, "2026-09-01").spend).toBe(null);
    expect(point(out, "2026-09-01").leads).toBe(null);
    expect(point(out, "2026-09-03").spend).toBe(null);
  });

  it("dia com linha e valor real 0 -> 0, não null", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [dailyRow({ date: "2026-09-01", spend: 0, impressions: 0 })],
    });
    expect(point(out, "2026-09-01").spend).toBe(0);
  });
});

describe("intervalo inválido também é recusado na série", () => {
  it("from > to lança exceção", () => {
    expect(() =>
      resolveMetricSeries({
        scope: SCOPE_SINGLE,
        range: { from: "2026-09-10", to: "2026-09-01" },
        metricIds: ["spend"],
        dailyRows: [],
      }),
    ).toThrow(/intervalo inválido/i);
  });
});

describe("range cobre todos os dias, mesmo sem linha em nenhum", () => {
  it("3 pontos para um range de 3 dias", () => {
    const out = resolveMetricSeries({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [],
    });
    expect(out.points.map((p) => p.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });
});
