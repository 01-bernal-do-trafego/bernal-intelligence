/**
 * FEATURE 02A — valores computados das métricas liberadas nesta rodada.
 *
 * `server/real-dashboard.ts` computa TODAS as métricas do Registry sobre um
 * único `MetricTotals` unificado: `{ ...curTotals (aditivas/periodic-exato),
 * actions: curConvTotals.actions, actionValues: curConvTotals.actionValues }`.
 * Este arquivo reproduz EXATAMENTE esse padrão com fixtures — prova que a
 * união funciona sem precisar mockar Supabase (mesma primitiva pura,
 * `computeMetric`, que o servidor chama).
 */
import { describe, expect, it } from "vitest";
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import { getMetricDefinition, METRIC_REGISTRY } from "@/lib/metrics/registry";

/** Totais "coluna" (aditivas + periodic-exato) — como `curTotals`/`buildRealTotals`. */
function columnTotals(over: Partial<MetricTotals> = {}): MetricTotals {
  return {
    spend: 1543.08,
    impressions: 109573,
    clicks: 4407,
    inline_link_clicks: 3800,
    reach: 21000,
    frequency: 5.22,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {},
    actionValues: {},
    ...over,
  };
}

/** Une totais de coluna com ações resolvidas — o padrão `curAllTotals` de
 * `server/real-dashboard.ts`. */
function unify(base: MetricTotals, actions: Record<string, number>, actionValues: Record<string, number> = {}): MetricTotals {
  return { ...base, actions, actionValues };
}

describe("FEATURE 02A — métricas action-sourced calculam sobre totals.actions (aditivas)", () => {
  const actions = {
    leads: 12,
    purchases: 0, // evento MEDIDO com zero — nunca vira null
    registrations: 3,
    appointments: 2,
    add_to_cart: 67,
    initiate_checkout: 0,
    landing_page_views: 1270,
    post_engagement: 3229,
    post_reactions: 827,
    post_comments: 343,
    post_saves: 465,
    video_views: 3048,
  };
  const totals = unify(columnTotals(), actions);

  it.each(Object.entries(actions))("%s = %d (valor direto de totals.actions)", (id, expected) => {
    expect(computeMetric(id, totals)).toBe(expected);
  });

  it("evento AUSENTE (não medido) -> null, nunca 0", () => {
    const empty = unify(columnTotals(), {});
    expect(computeMetric("leads", empty)).toBeNull();
    expect(computeMetric("purchases", empty)).toBeNull();
    expect(computeMetric("post_engagement", empty)).toBeNull();
  });
});

describe("FEATURE 02A — custos novos recomputam sobre spend (coluna) / evento (ação) — nunca soma/média diária", () => {
  const totals = unify(columnTotals({ spend: 1000 }), {
    landing_page_views: 200,
    add_to_cart: 50,
    initiate_checkout: 25,
    video_views: 400,
  });

  it("cost_per_landing_page_view = spend / landing_page_views", () => {
    expect(computeMetric("cost_per_landing_page_view", totals)).toBeCloseTo(1000 / 200, 6);
  });
  it("cost_per_add_to_cart = spend / add_to_cart", () => {
    expect(computeMetric("cost_per_add_to_cart", totals)).toBeCloseTo(1000 / 50, 6);
  });
  it("cost_per_initiate_checkout = spend / initiate_checkout", () => {
    expect(computeMetric("cost_per_initiate_checkout", totals)).toBeCloseTo(1000 / 25, 6);
  });
  it("cost_per_video_view = spend / video_views", () => {
    expect(computeMetric("cost_per_video_view", totals)).toBeCloseTo(1000 / 400, 6);
  });

  it("denominador AUSENTE (evento nunca ocorreu) -> null, nunca dividir por zero/Infinity", () => {
    const noEvents = unify(columnTotals({ spend: 1000 }), {});
    expect(computeMetric("cost_per_landing_page_view", noEvents)).toBeNull();
    expect(computeMetric("cost_per_add_to_cart", noEvents)).toBeNull();
  });

  it("denominador MEDIDO com zero (evento ocorreu 0 vezes) -> 0, não null (safeDivide)", () => {
    const zeroEvents = unify(columnTotals({ spend: 1000 }), { landing_page_views: 0 });
    expect(computeMetric("cost_per_landing_page_view", zeroEvents)).toBe(0);
  });
});

describe("FEATURE 02A — ecommerce: cpa/roas/revenue sobre a MESMA união (spend da coluna + purchases/revenue da ação)", () => {
  it("cpa = spend / purchases; roas = revenue / spend", () => {
    const totals = unify(
      columnTotals({ spend: 500 }),
      { purchases: 10 },
      { revenue: 2500 },
    );
    expect(computeMetric("cpa", totals)).toBeCloseTo(500 / 10, 6);
    expect(computeMetric("roas", totals)).toBeCloseTo(2500 / 500, 6);
  });

  it("sem purchase/revenue no período (clientes sem ecommerce, ex.: Atacado do Chinelo hoje) -> indisponível, não 0/erro", () => {
    const totals = unify(columnTotals({ spend: 500 }), {});
    expect(computeMetric("purchases", totals)).toBeNull();
    expect(computeMetric("revenue", totals)).toBeNull();
    expect(computeMetric("cpa", totals)).toBeNull();
    expect(computeMetric("roas", totals)).toBeNull();
  });
});

describe("FEATURE 02A — cliques no link: coluna + ratio, funcionam com a totals unificada (sem action nenhuma)", () => {
  const totals = unify(columnTotals({ inline_link_clicks: 500, impressions: 10000, spend: 100 }), {});

  it("inline_link_clicks = valor direto da coluna", () => {
    expect(computeMetric("inline_link_clicks", totals)).toBe(500);
  });
  it("ctr_link = inline_link_clicks / impressions * 100", () => {
    expect(computeMetric("ctr_link", totals)).toBeCloseTo((500 / 10000) * 100, 6);
  });
  it("cpc_link = spend / inline_link_clicks", () => {
    expect(computeMetric("cpc_link", totals)).toBeCloseTo(100 / 500, 6);
  });
});

describe("FEATURE 02A — reach/frequency NUNCA vêm da união de ações (continuam periodic-exato-only)", () => {
  it("reach/frequency ignoram totals.actions completamente — mudar actions não muda o valor", () => {
    // `frequency` no Registry é FÓRMULA (impressions/reach, recalculada — nunca
    // lida direto de `totals.frequency`); por isso as fixtures usam
    // impressions/reach coerentes, não um `frequency` solto.
    const base = columnTotals({ reach: 21000, impressions: 109620 }); // 109620/21000 = 5.22
    const withActions = unify(base, { leads: 999, purchases: 999 });
    const withoutActions = unify(base, {});
    expect(computeMetric("reach", withActions)).toBe(computeMetric("reach", withoutActions));
    expect(computeMetric("frequency", withActions)).toBe(computeMetric("frequency", withoutActions));
    expect(computeMetric("reach", withActions)).toBe(21000);
    expect(computeMetric("frequency", withActions)).toBeCloseTo(5.22, 6);
  });

  it("reach ausente (sem periodic exato) -> null, nunca reconstruído de nenhuma ação", () => {
    const noPeriodic = unify(columnTotals({ reach: null, frequency: null }), {
      leads: 5,
    });
    expect(computeMetric("reach", noPeriodic)).toBeNull();
    expect(computeMetric("frequency", noPeriodic)).toBeNull();
  });
});

describe("FEATURE 02A — toda métrica liberada (card/chart) tem definição íntegra no Registry", () => {
  const RELEASED_IDS = [
    "inline_link_clicks",
    "ctr_link",
    "cpc_link",
    "leads",
    "cpl",
    "purchases",
    "cpa",
    "revenue",
    "roas",
    "landing_page_views",
    "cost_per_landing_page_view",
    "add_to_cart",
    "cost_per_add_to_cart",
    "initiate_checkout",
    "cost_per_initiate_checkout",
    "registrations",
    "appointments",
    "post_engagement",
    "post_reactions",
    "post_comments",
    "post_saves",
    "video_views",
    "cost_per_video_view",
  ];

  it.each(RELEASED_IDS)("%s existe no Registry, com card ou chart liberado", (id) => {
    const def = getMetricDefinition(id);
    expect(def, id).toBeDefined();
    expect(
      def!.dashboardSurfaces.includes("card") || def!.dashboardSurfaces.includes("chart"),
      id,
    ).toBe(true);
  });

  it("nenhum id liberado colide com um id já existente antes da FEATURE 02A (sem sobrescrita silenciosa)", () => {
    const ids = METRIC_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
