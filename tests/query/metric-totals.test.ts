import { describe, expect, it } from "vitest";
import { resolveMetricTotals } from "@/lib/query/metric-totals";
import {
  ACCOUNT_ID,
  SCOPE_SINGLE,
  dailyRow,
  periodicRow,
  scopeWith,
} from "./fixtures";

const RANGE = { from: "2026-09-01", to: "2026-09-03" };

function entryOf(results: ReturnType<typeof resolveMetricTotals>, id: string) {
  const found = results.find((r) => r.metricId === id);
  if (!found) throw new Error(`metricId "${id}" não está no resultado`);
  return found;
}
function valueOf(results: ReturnType<typeof resolveMetricTotals>, id: string) {
  return entryOf(results, id).value;
}
function qualityOf(results: ReturnType<typeof resolveMetricTotals>, id: string) {
  return entryOf(results, id).quality;
}

describe("resolveMetricTotals — direct_sum (aditivas)", () => {
  const daily = [
    dailyRow({ date: "2026-09-01", spend: 100, impressions: 1000, clicks: 10 }),
    dailyRow({ date: "2026-09-02", spend: 200, impressions: 2000, clicks: 20 }),
    dailyRow({ date: "2026-09-03", spend: 300, impressions: 3000, clicks: 30 }),
  ];

  it("1. spend total = soma diária", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(600);
  });

  it("2. impressions total = soma diária", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["impressions"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "impressions")).toBe(6000);
  });
});

describe("resolveMetricTotals — recompute_from_components (ratios)", () => {
  const daily = [
    dailyRow({ date: "2026-09-01", spend: 100, impressions: 1000, clicks: 10 }),
    dailyRow({ date: "2026-09-02", spend: 200, impressions: 2000, clicks: 30 }),
  ];

  it("3. CTR = SUM(clicks)/SUM(impressions)*100 — nunca média das diárias", () => {
    // dia 1: 10/1000=1%  dia 2: 30/2000=1.5%  média simples seria 1.25%
    // correto: (10+30)/(1000+2000)*100 = 40/3000*100 = 1.333...%
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["ctr"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "ctr")).toBeCloseTo((40 / 3000) * 100, 10);
  });

  it("4. CPC = SUM(spend)/SUM(clicks)", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["cpc"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "cpc")).toBeCloseTo(300 / 40, 10);
  });

  it("5. CPM = SUM(spend)/SUM(impressions)*1000", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["cpm"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "cpm")).toBeCloseTo((300 / 3000) * 1000, 10);
  });

  it("6. CPL = SUM(spend)/SUM(leads)", () => {
    const daily2 = [
      dailyRow({ date: "2026-09-01", spend: 100, raw_actions: { lead: 2 } }),
      dailyRow({ date: "2026-09-02", spend: 200, raw_actions: { lead: 3 } }),
    ];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["cpl", "leads"],
      dailyRows: daily2,
      periodicRows: [],
    });
    expect(valueOf(out, "leads")).toBe(5);
    expect(valueOf(out, "cpl")).toBeCloseTo(300 / 5, 10);
  });

  it("8. ROAS = SUM(revenue)/SUM(spend)", () => {
    const daily2 = [
      dailyRow({
        date: "2026-09-01",
        spend: 100,
        raw_actions: { omni_purchase: 1 },
        raw_action_values: { omni_purchase: 500 },
      }),
      dailyRow({
        date: "2026-09-02",
        spend: 200,
        raw_actions: { omni_purchase: 2 },
        raw_action_values: { omni_purchase: 700 },
      }),
    ];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["roas", "revenue"],
      dailyRows: daily2,
      periodicRows: [],
    });
    expect(valueOf(out, "revenue")).toBe(1200);
    expect(valueOf(out, "roas")).toBeCloseTo(1200 / 300, 10);
  });
});

describe("7. result_metric config-driven (results / cost_per_result)", () => {
  const daily = [
    dailyRow({ date: "2026-09-01", spend: 150, raw_actions: { lead: 3 } }),
    dailyRow({ date: "2026-09-02", spend: 150, raw_actions: { lead: 2 } }),
  ];

  it("resultMetric='leads' -> results = leads somados, cost_per_result = spend/results", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["results", "cost_per_result"],
      dailyRows: daily,
      periodicRows: [],
      resultMetric: "leads",
    });
    expect(valueOf(out, "results")).toBe(5);
    expect(valueOf(out, "cost_per_result")).toBeCloseTo(300 / 5, 10);
  });

  it("sem resultMetric configurado -> results indisponível (null), não 0", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["results", "cost_per_result"],
      dailyRows: daily,
      periodicRows: [],
      resultMetric: null,
    });
    expect(valueOf(out, "results")).toBe(null);
    expect(valueOf(out, "cost_per_result")).toBe(null);
  });

  it("não hardcoda 'results = conversations' — resultMetric='purchases' resolve purchases", () => {
    const daily2 = [
      dailyRow({ date: "2026-09-01", spend: 100, raw_actions: { omni_purchase: 4 } }),
    ];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["results"],
      dailyRows: daily2,
      periodicRows: [],
      resultMetric: "purchases",
    });
    expect(valueOf(out, "results")).toBe(4);
  });
});

describe("9-10. reach/frequency — exact_periodic_only, NUNCA somados entre dias", () => {
  const daily = [
    dailyRow({ date: "2026-09-01", reach: 1000, frequency: 1.2 }),
    dailyRow({ date: "2026-09-02", reach: 900, frequency: 1.1 }),
    dailyRow({ date: "2026-09-03", reach: 950, frequency: 1.3 }),
  ];

  it("9. reach do período vem do periodic exato, NÃO da soma das diárias (1000+900+950=2850)", () => {
    const periodic = [periodicRow({ date_from: RANGE.from, date_to: RANGE.to, reach: 1500 })];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["reach"],
      dailyRows: daily,
      periodicRows: periodic,
    });
    expect(valueOf(out, "reach")).toBe(1500);
    expect(valueOf(out, "reach")).not.toBe(2850);
  });

  it("10. frequency do período vem do periodic exato (impressions/reach DAQUELA linha), não é somada/mediada", () => {
    // frequency é uma fórmula (impressions/reach) do REGISTRY — recalculada
    // sobre o próprio periodic exato, nunca sobre a soma das diárias.
    const periodic = [
      periodicRow({
        date_from: RANGE.from,
        date_to: RANGE.to,
        impressions: 4260,
        reach: 3000, // 4260/3000 = 1.42
      }),
    ];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["frequency"],
      dailyRows: daily,
      periodicRows: periodic,
    });
    expect(valueOf(out, "frequency")).toBeCloseTo(1.42, 10);
  });

  it("sem periodic exato -> reach/frequency null (não soma daily como fallback)", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["reach", "frequency"],
      dailyRows: daily,
      periodicRows: [], // nenhum periodic
    });
    expect(valueOf(out, "reach")).toBe(null);
    expect(valueOf(out, "frequency")).toBe(null);
    expect(qualityOf(out, "reach")?.state).toBe("no_data");
    expect(qualityOf(out, "reach")?.reasons).toContain("no_exact_periodic_match");
  });

  it("escopo multi-entidade -> reach/frequency indisponíveis mesmo com periodic por entidade", () => {
    const scope = scopeWith(["act_1", "act_2"]);
    const periodic = [
      periodicRow({ date_from: RANGE.from, date_to: RANGE.to, entity_id: "act_1", reach: 1000 }),
      periodicRow({ date_from: RANGE.from, date_to: RANGE.to, entity_id: "act_2", reach: 800 }),
    ];
    const out = resolveMetricTotals({
      scope,
      range: RANGE,
      metricIds: ["reach"],
      dailyRows: [],
      periodicRows: periodic,
    });
    expect(valueOf(out, "reach")).toBe(null);
    expect(qualityOf(out, "reach")?.reasons).toContain("not_consolidable_multi_entity");
  });
});

describe("13-14. zero real vs ausência de dado", () => {
  it("13. nenhuma linha -> null (não 0)", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend", "impressions", "leads"],
      dailyRows: [],
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(null);
    expect(valueOf(out, "impressions")).toBe(null);
    expect(valueOf(out, "leads")).toBe(null);
    expect(qualityOf(out, "spend")?.state).toBe("no_data");
  });

  it("14. linha real com spend=0 -> 0 (zero real), não null", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [dailyRow({ date: "2026-09-01", spend: 0, impressions: 0 })],
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(0);
  });
});

describe("15-17. raw_actions / raw_action_values", () => {
  it("15. raw_actions resolve leads", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["leads"],
      dailyRows: [dailyRow({ date: "2026-09-01", raw_actions: { lead: 7 } })],
      periodicRows: [],
    });
    expect(valueOf(out, "leads")).toBe(7);
  });

  it("16. raw_actions resolve messaging_conversations_started", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["messaging_conversations_started"],
      dailyRows: [
        dailyRow({
          date: "2026-09-01",
          raw_actions: { "onsite_conversion.messaging_conversation_started_7d": 4 },
        }),
      ],
      periodicRows: [],
    });
    expect(valueOf(out, "messaging_conversations_started")).toBe(4);
  });

  it("17. raw_action_values resolve revenue", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["revenue"],
      dailyRows: [
        dailyRow({
          date: "2026-09-01",
          raw_actions: { purchase: 1 },
          raw_action_values: { purchase: 250.5 },
        }),
      ],
      periodicRows: [],
    });
    expect(valueOf(out, "revenue")).toBe(250.5);
  });
});

describe("18. attribution dedupe preservado (sem dupla contagem)", () => {
  it("unified + legado no mesmo dia -> só unified entra (não soma as duas janelas)", () => {
    const daily = [
      dailyRow({
        date: "2026-09-01",
        attribution_window: "unified_attribution",
        spend: 100,
        raw_actions: { lead: 5 },
      }),
      dailyRow({
        date: "2026-09-01",
        attribution_window: "7d_click_1d_view",
        spend: 999, // se somasse, spend viraria 1099 — bug de dupla contagem
        raw_actions: { lead: 999 },
      }),
    ];
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: { from: "2026-09-01", to: "2026-09-01" },
      metricIds: ["spend", "leads"],
      dailyRows: daily,
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(100);
    expect(valueOf(out, "leads")).toBe(5);
  });
});

// 20 (previous = 0 não gera Infinity) é coberto em metric-comparison.test.ts —
// resolveMetricTotals não lida com comparação, só com totais de um período.

describe("21. metricId desconhecido falha SEM lançar exceção", () => {
  it("retorna value:null + quality com motivo, e não afeta os outros ids", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["nao_existe_isso", "spend"],
      dailyRows: [dailyRow({ date: "2026-09-01", spend: 100 })],
      periodicRows: [],
    });
    expect(valueOf(out, "nao_existe_isso")).toBe(null);
    expect(qualityOf(out, "nao_existe_isso")?.reasons).toContain("unknown_metric");
    expect(valueOf(out, "spend")).toBe(100); // não contaminado pelo id inválido
  });
});

describe("22. nível incompatível é recusado (sem exceção)", () => {
  it("hook_rate não existe em 'account'", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE, // level: account
      range: RANGE,
      metricIds: ["hook_rate"],
      dailyRows: [],
      periodicRows: [],
    });
    expect(valueOf(out, "hook_rate")).toBe(null);
    expect(qualityOf(out, "hook_rate")?.reasons).toContain("level_not_supported");
  });
});

describe("23. range inválido (from > to) é recusado — falha DURA", () => {
  it("lança exceção", () => {
    expect(() =>
      resolveMetricTotals({
        scope: SCOPE_SINGLE,
        range: { from: "2026-09-10", to: "2026-09-01" },
        metricIds: ["spend"],
        dailyRows: [],
        periodicRows: [],
      }),
    ).toThrow(/intervalo inválido/i);
  });
});

describe("performance_trend — sem semântica matemática", () => {
  it("não agrega, retorna null com motivo honesto", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["performance_trend"],
      dailyRows: [dailyRow({ date: "2026-09-01", spend: 100 })],
      periodicRows: [],
    });
    expect(valueOf(out, "performance_trend")).toBe(null);
    expect(qualityOf(out, "performance_trend")?.reasons).toContain(
      "no_aggregation_semantics",
    );
  });
});

describe("escopo/cliente defensivo", () => {
  it("linha de outro client_id não entra na soma (rede de segurança)", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", spend: 100 }),
        dailyRow({ date: "2026-09-01", spend: 9999, client_id: "outro-cliente" }),
      ],
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(100);
  });

  it("linha de outra entidade fora do escopo não entra na soma", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE, // entityIds: [ACCOUNT_ID]
      range: RANGE,
      metricIds: ["spend"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", spend: 100, entity_id: ACCOUNT_ID }),
        dailyRow({ date: "2026-09-01", spend: 9999, entity_id: "act_outra" }),
      ],
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(100);
  });

  it("linha fora do range não entra na soma", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: { from: "2026-09-02", to: "2026-09-03" },
      metricIds: ["spend"],
      dailyRows: [
        dailyRow({ date: "2026-09-01", spend: 9999 }), // fora do range
        dailyRow({ date: "2026-09-02", spend: 100 }),
      ],
      periodicRows: [],
    });
    expect(valueOf(out, "spend")).toBe(100);
  });
});
