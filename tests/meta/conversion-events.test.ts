import { describe, expect, it } from "vitest";
import {
  buildConversionRows,
  conversionTotalsFromRow,
  describeEvents,
  resultMetricSource,
} from "@/lib/meta/conversion-events";
import { computeMetric } from "@/lib/metrics/compute";

/**
 * Simula o que a Edge Function grava em meta_insights_periodic:
 * `actions`/`action_values` = já resolvidos por PRIORIDADE (metricId -> valor);
 * `raw_actions`/`raw_action_values` = action_type cru -> valor.
 */
function periodicRow(over: Record<string, unknown> = {}) {
  return {
    spend: 1000,
    impressions: 50000,
    clicks: 800,
    reach: 30000,
    frequency: 1.6,
    actions: {},
    action_values: {},
    raw_actions: {},
    raw_action_values: {},
    ...over,
  };
}

describe("describeEvents — nunca descarta, marca mapeado/revisão", () => {
  it("lista mapeados e não mapeados, mapeados primeiro", () => {
    const rows = describeEvents(
      {
        purchase: 7,
        "onsite_conversion.messaging_conversation_started_7d": 42,
        evento_novo_2027: 13,
      },
      { purchase: 1420 },
    );
    expect(rows.map((r) => r.actionType)).toEqual([
      "onsite_conversion.messaging_conversation_started_7d", // 42, mapeado
      "purchase", // 7, mapeado
      "evento_novo_2027", // não mapeado -> por último
    ]);
    expect(rows.find((r) => r.actionType === "purchase")).toMatchObject({
      count: 7,
      value: 1420,
      bernalMetric: "purchases",
      bernalValueMetric: "revenue",
      status: "mapped",
    });
    expect(rows.find((r) => r.actionType === "evento_novo_2027")).toMatchObject({
      count: 13,
      value: null,
      bernalMetric: null,
      status: "unmapped",
    });
  });

  it("action_type desconhecido é preservado (para ampliar o registry depois)", () => {
    const rows = describeEvents({ foo_bar_baz: 3 }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: "foo_bar_baz", count: 3, status: "unmapped" });
  });

  it("distingue valor ausente (null) de zero medido", () => {
    const rows = describeEvents({ lead: 0 }, {});
    expect(rows[0].count).toBe(0); // zero medido
    const none = describeEvents({}, {});
    expect(none).toEqual([]); // ausência total
  });
});

describe("conversionTotalsFromRow + computeMetric — dupla contagem", () => {
  it("actions já resolvido: purchases = 7 (não 21) mesmo com 3 aliases nos crus", () => {
    // a Edge Function já resolveu por prioridade -> actions.purchases = 7
    const t = conversionTotalsFromRow(
      periodicRow({
        spend: 700,
        actions: { purchases: 7, leads: 40 },
        action_values: { revenue: 1400 },
      }),
    );
    expect(computeMetric("purchases", t)).toBe(7);
    expect(computeMetric("leads", t)).toBe(40);
    expect(computeMetric("revenue", t)).toBe(1400);
  });

  it("CPA = spend/purchases sobre totais brutos", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 700, actions: { purchases: 7 } }));
    expect(computeMetric("cpa", t)).toBeCloseTo(100, 6);
  });

  it("CPL = spend/leads", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 800, actions: { leads: 40 } }));
    expect(computeMetric("cpl", t)).toBeCloseTo(20, 6);
  });

  it("custo por conversa = spend/conversations", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 420, actions: { conversations: 42 } }));
    expect(computeMetric("cost_per_conversation", t)).toBeCloseTo(10, 6);
  });

  it("ROAS = revenue/spend", () => {
    const t = conversionTotalsFromRow(
      periodicRow({ spend: 700, action_values: { revenue: 2800 } }),
    );
    expect(computeMetric("roas", t)).toBeCloseTo(4, 6);
  });

  it("cost_per_result = spend/results", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 500, actions: { results: 25 } }));
    expect(computeMetric("cost_per_result", t)).toBeCloseTo(20, 6);
  });

  it("conversão ausente => métrica null (≠ zero)", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 500, actions: {} }));
    expect(computeMetric("purchases", t)).toBeNull();
    expect(computeMetric("cpa", t)).toBeNull();
    expect(computeMetric("roas", t)).toBeNull();
  });

  it("conversão = 0 medido => métrica 0, custo protegido (divisão por zero)", () => {
    const t = conversionTotalsFromRow(periodicRow({ spend: 500, actions: { purchases: 0 } }));
    expect(computeMetric("purchases", t)).toBe(0);
    expect(computeMetric("cpa", t)).toBe(0); // safeDivide protege
  });
});

describe("buildConversionRows — Métrica · Valor · Fonte", () => {
  const t = conversionTotalsFromRow(
    periodicRow({
      spend: 700,
      actions: { purchases: 7, leads: 40, conversations: 12, results: 7 },
      action_values: { revenue: 2800 },
    }),
  );
  const rows = buildConversionRows({
    totals: t,
    rawActions: {
      omni_purchase: 7,
      purchase: 7,
      lead: 40,
      "onsite_conversion.messaging_conversation_started_7d": 12,
    },
    rawActionValues: { omni_purchase: 2800 },
    resultType: "purchases",
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  it("fonte da contagem = primeiro alias presente (prioridade)", () => {
    expect(byId.get("purchases")).toMatchObject({ value: 7, source: "omni_purchase" });
    expect(byId.get("leads")).toMatchObject({ value: 40, source: "lead" });
    expect(byId.get("conversations")).toMatchObject({
      value: 12,
      source: "onsite_conversion.messaging_conversation_started_7d",
    });
  });

  it("receita usa action_value do alias prioritário", () => {
    expect(byId.get("revenue")).toMatchObject({ value: 2800, source: "omni_purchase" });
  });

  it("métricas calculadas mostram a fórmula como fonte", () => {
    expect(byId.get("cpa")?.source).toMatch(/spend \/ purchases/);
    expect(byId.get("roas")?.source).toMatch(/revenue \/ spend/);
    expect(byId.get("cpa")?.value).toBeCloseTo(100, 6);
    expect(byId.get("roas")?.value).toBeCloseTo(4, 6);
  });

  it("results usa o action_type do result_metric configurado", () => {
    expect(byId.get("results")).toMatchObject({ value: 7, source: "omni_purchase" });
  });

  it("sem fonte real => value null e source null", () => {
    const empty = buildConversionRows({
      totals: conversionTotalsFromRow(periodicRow({ spend: 500 })),
      rawActions: {},
      rawActionValues: {},
      resultType: "leads",
    });
    for (const r of empty) {
      expect(r.value).toBeNull();
      expect(r.source).toBeNull();
    }
  });
});

describe("result_metric por cliente", () => {
  it("leads / conversations / purchases resolvem a fonte correta", () => {
    expect(resultMetricSource("leads", { lead: 40, "offsite_conversion.fct.lead": 12 })).toBe("lead");
    expect(
      resultMetricSource("conversations", {
        "onsite_conversion.messaging_conversation_started_7d": 42,
      }),
    ).toBe("onsite_conversion.messaging_conversation_started_7d");
    expect(resultMetricSource("purchases", { purchase: 7 })).toBe("purchase");
  });

  it("result_metric indisponível => fonte null (não substitui por outra)", () => {
    expect(resultMetricSource("leads", { purchase: 7 })).toBeNull();
    expect(resultMetricSource("results", { lead: 40 })).toBeNull();
  });
});
