/**
 * DATA FOUNDATION V2 — Aggregation Safety.
 * Torna impossível regressão silenciosa em "como agrego esta métrica?".
 *
 * Distinção central:
 *   direct_sum                 -> SUM(valores)
 *   recompute_from_components  -> agregar componentes brutos e reaplicar a fórmula
 *   exact_periodic_only        -> só do agregado periódico exato
 *   none                       -> métrica sem semântica matemática
 */
import { describe, expect, it } from "vitest";
import {
  aggregationMethod,
  canRecomputeFromComponents,
  canSumAcrossEntities,
  canSumAcrossTime,
  canUseMetricInChartRole,
  canUseMetricInFunnel,
  getMetricAggregationClass,
  getRelatedMetrics,
  getSignificanceMetric,
  isAdditiveMetric,
  requiresExactPeriodicAggregate,
} from "@/lib/metrics/aggregation";
import { isMetricAdditive } from "@/lib/metrics/registry";

describe("aditivas -> soma direta (tempo e entidades)", () => {
  for (const id of [
    "spend",
    "impressions",
    "clicks",
    "inline_link_clicks",
    "leads",
    "purchases",
    "messaging_conversations_started",
    "results",
    "revenue",
  ]) {
    it(`${id} = direct_sum`, () => {
      expect(aggregationMethod(id)).toBe("direct_sum");
      expect(isAdditiveMetric(id)).toBe(true);
      expect(isMetricAdditive(id)).toBe(true);
      expect(canSumAcrossTime(id)).toBe(true);
      expect(canSumAcrossEntities(id)).toBe(true);
      expect(canRecomputeFromComponents(id)).toBe(false);
      expect(requiresExactPeriodicAggregate(id)).toBe(false);
    });
  }
});

describe("CTR / CPC / CPM / CPA — nunca soma direta; recomputáveis dos componentes", () => {
  for (const id of [
    "ctr",
    "ctr_link",
    "cpc",
    "cpc_link",
    "cpm",
    "cpa",
    "cpl",
    "roas",
    "cost_per_result",
    "cost_per_conversation",
    "hook_rate",
    "thruplay_rate",
  ]) {
    it(`${id} = recompute_from_components`, () => {
      expect(getMetricAggregationClass(id)).toBe("ratio");
      expect(aggregationMethod(id)).toBe("recompute_from_components");
      // NUNCA soma direta / aditiva
      expect(isAdditiveMetric(id)).toBe(false);
      expect(canSumAcrossTime(id)).toBe(false);
      expect(canSumAcrossEntities(id)).toBe(false);
      // MAS pode ser recalculado das dependências brutas
      expect(canRecomputeFromComponents(id)).toBe(true);
      expect(requiresExactPeriodicAggregate(id)).toBe(false);
    });
  }

  it("CTR = SUM(clicks)/SUM(impressions): as duas dependências são soma direta", () => {
    // clicks e impressions são direct_sum -> CTR é recomputável
    expect(aggregationMethod("clicks")).toBe("direct_sum");
    expect(aggregationMethod("impressions")).toBe("direct_sum");
    expect(canRecomputeFromComponents("ctr")).toBe(true);
  });

  it("CPA = SUM(spend)/SUM(purchases): idem", () => {
    expect(aggregationMethod("spend")).toBe("direct_sum");
    expect(aggregationMethod("purchases")).toBe("direct_sum");
    expect(canRecomputeFromComponents("cpa")).toBe(true);
  });
});

describe("reach — nem soma, nem recálculo por soma diária", () => {
  it("reach = exact_periodic_only", () => {
    expect(getMetricAggregationClass("reach")).toBe("unique_non_additive");
    expect(aggregationMethod("reach")).toBe("exact_periodic_only");
    expect(isAdditiveMetric("reach")).toBe(false);
    expect(isMetricAdditive("reach")).toBe(false);
    expect(canSumAcrossTime("reach")).toBe(false);
    expect(canSumAcrossEntities("reach")).toBe(false);
    expect(canRecomputeFromComponents("reach")).toBe(false);
    expect(requiresExactPeriodicAggregate("reach")).toBe(true);
  });
});

describe("frequency — não recomputável sem reach autoritativo", () => {
  it("frequency = exact_periodic_only (um componente, reach, não é somável)", () => {
    expect(getMetricAggregationClass("frequency")).toBe("unique_non_additive");
    expect(aggregationMethod("frequency")).toBe("exact_periodic_only");
    expect(canSumAcrossTime("frequency")).toBe(false);
    expect(canRecomputeFromComponents("frequency")).toBe(false);
    expect(requiresExactPeriodicAggregate("frequency")).toBe(true);
    // a garantia estrutural: reach (componente da fórmula) NÃO é soma direta
    expect(aggregationMethod("reach")).not.toBe("direct_sum");
  });
});

describe("video_avg_time_watched — não agrega sem denominador de peso válido", () => {
  it("classificada conservadoramente (sem video_plays armazenado)", () => {
    expect(getMetricAggregationClass("video_avg_time_watched")).toBe(
      "unique_non_additive",
    );
    expect(aggregationMethod("video_avg_time_watched")).toBe("exact_periodic_only");
    expect(isAdditiveMetric("video_avg_time_watched")).toBe(false);
    expect(canSumAcrossTime("video_avg_time_watched")).toBe(false);
    expect(canRecomputeFromComponents("video_avg_time_watched")).toBe(false);
  });
});

describe("performance_trend — sem semântica matemática falsa", () => {
  it("classe null, método 'none', nenhuma agregação permitida", () => {
    expect(getMetricAggregationClass("performance_trend")).toBe(null);
    expect(aggregationMethod("performance_trend")).toBe("none");
    expect(isAdditiveMetric("performance_trend")).toBe(false);
    expect(canSumAcrossTime("performance_trend")).toBe(false);
    expect(canSumAcrossEntities("performance_trend")).toBe(false);
    expect(canRecomputeFromComponents("performance_trend")).toBe(false);
    expect(requiresExactPeriodicAggregate("performance_trend")).toBe(false);
  });
  it("NÃO é classificada como snapshot", () => {
    expect(getMetricAggregationClass("performance_trend")).not.toBe("snapshot");
  });
});

describe("id inexistente é seguro (nunca agrega)", () => {
  it("classe null, método 'none'", () => {
    expect(getMetricAggregationClass("nao_existe")).toBe(null);
    expect(aggregationMethod("nao_existe")).toBe("none");
    expect(isAdditiveMetric("nao_existe")).toBe(false);
    expect(canSumAcrossTime("nao_existe")).toBe(false);
    expect(canSumAcrossEntities("nao_existe")).toBe(false);
    expect(canRecomputeFromComponents("nao_existe")).toBe(false);
    expect(canUseMetricInFunnel("nao_existe")).toBe(false);
    expect(canUseMetricInChartRole("nao_existe", "kpi")).toBe(false);
  });
});

describe("chart roles", () => {
  it("canUseMetricInChartRole reflete a declaração do registry", () => {
    expect(canUseMetricInChartRole("spend", "timeseries")).toBe(true);
    expect(canUseMetricInChartRole("spend", "kpi")).toBe(true);
    expect(canUseMetricInChartRole("spend", "categorical")).toBe(true); // additive
    expect(canUseMetricInChartRole("ctr", "categorical")).toBe(false); // ratio
    expect(canUseMetricInChartRole("reach", "categorical")).toBe(false); // non-additive
    expect(canUseMetricInChartRole("cpa", "funnel")).toBe(false);
    expect(canUseMetricInChartRole("leads", "funnel")).toBe(true);
  });
});

describe("funnel eligibility", () => {
  it("só volume/evento entra em funil", () => {
    for (const id of ["impressions", "clicks", "leads", "purchases", "results"]) {
      expect(canUseMetricInFunnel(id), id).toBe(true);
    }
    for (const id of ["ctr", "cpc", "cpm", "cpa", "roas", "reach", "frequency", "spend"]) {
      expect(canUseMetricInFunnel(id), id).toBe(false);
    }
  });
});

describe("significance / related (base do Intelligence)", () => {
  it("ratios de custo declaram a métrica de volume relevante", () => {
    expect(getSignificanceMetric("cpa")).toBe("purchases");
    expect(getSignificanceMetric("cpl")).toBe("leads");
    expect(getSignificanceMetric("cost_per_result")).toBe("results");
    expect(getSignificanceMetric("ctr")).toBe("impressions");
  });
  it("métricas de contagem não precisam de significanceMetric", () => {
    expect(getSignificanceMetric("impressions")).toBe(null);
    expect(getSignificanceMetric("leads")).toBe(null);
  });
  it("relatedMetrics traz correlatos fortes e sem auto-referência", () => {
    const rel = getRelatedMetrics("cpa");
    expect(rel).toContain("spend");
    expect(rel).toContain("purchases");
    expect(rel).not.toContain("cpa");
  });
});

describe("cobertura: todo ratio do registry é recomputável OU exige periódico exato — nunca soma", () => {
  it("nenhum ratio é direct_sum", () => {
    const ids = [
      "ctr",
      "ctr_link",
      "cpc",
      "cpc_link",
      "cpm",
      "cpa",
      "cpl",
      "roas",
      "cost_per_result",
      "cost_per_conversation",
      "hook_rate",
      "thruplay_rate",
    ];
    for (const id of ids) {
      const m = aggregationMethod(id);
      expect(["recompute_from_components", "exact_periodic_only"], id).toContain(m);
      expect(m, id).not.toBe("direct_sum");
    }
  });
});
