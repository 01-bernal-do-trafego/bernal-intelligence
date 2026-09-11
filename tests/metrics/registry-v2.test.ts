/**
 * DATA FOUNDATION V2 — metadados aditivos do Metric Registry.
 * Não duplica `tests/metrics/registry.test.ts` (ids únicos, refs de fórmula,
 * aliases já cobertos lá); foca no que a V2.0 acrescentou.
 */
import { describe, expect, it } from "vitest";
import {
  METRIC_REGISTRY,
  getMetricDefinition,
  getMetricDependencies,
  isMetricAdditive,
  resolveMetricId,
  type AggregationClass,
  type ChartRole,
  type MetricUnit,
} from "@/lib/metrics/registry";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";

const AGG_CLASSES = new Set<AggregationClass>([
  "additive",
  "unique_non_additive",
  "ratio",
  "weighted_avg",
  "snapshot",
]);
const UNITS = new Set<MetricUnit>([
  "currency",
  "count",
  "percent",
  "decimal",
  "duration",
  "ratio",
]);
const ROLES = new Set<ChartRole>([
  "kpi",
  "timeseries",
  "categorical",
  "table",
  "funnel",
  "intelligence",
]);

describe("registry V2 — forma dos metadados novos", () => {
  it("unit / chartRoles / funnelEligible / breakdownsCompatible válidos em toda métrica", () => {
    for (const m of METRIC_REGISTRY) {
      expect(UNITS.has(m.unit), m.id).toBe(true);
      expect(Array.isArray(m.chartRoles) && m.chartRoles.length > 0, m.id).toBe(true);
      expect(m.chartRoles.every((r) => ROLES.has(r)), m.id).toBe(true);
      expect(typeof m.funnelEligible, m.id).toBe("boolean");
      expect(Array.isArray(m.breakdownsCompatible), m.id).toBe(true);
      // nesta fase nada busca breakdown -> vazio para todas
      expect(m.breakdownsCompatible.length, m.id).toBe(0);
    }
  });

  it("aggregationClass: presente e válido em toda métrica REAL; ausente só no placeholder bernal", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.availability === "bernal_planned") {
        expect(m.aggregationClass, `${m.id} placeholder não deve ter classe matemática`).toBeUndefined();
      } else {
        expect(m.aggregationClass, m.id).toBeDefined();
        expect(AGG_CLASSES.has(m.aggregationClass as AggregationClass), m.id).toBe(true);
      }
    }
  });

  it("ids continuam únicos após a V2", () => {
    const ids = METRIC_REGISTRY.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("significanceMetric e relatedMetrics, quando presentes, apontam para métricas existentes", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.significanceMetric) {
        expect(getMetricDefinition(m.significanceMetric), `${m.id}.significanceMetric`).toBeDefined();
      }
      for (const r of m.relatedMetrics ?? []) {
        expect(getMetricDefinition(r), `${m.id}.relatedMetrics -> ${r}`).toBeDefined();
        expect(r, `${m.id} related a si mesmo`).not.toBe(m.id);
      }
    }
  });

  it("classificação matemática das métricas atuais", () => {
    const expected: Record<string, AggregationClass> = {
      spend: "additive",
      impressions: "additive",
      clicks: "additive",
      inline_link_clicks: "additive",
      leads: "additive",
      purchases: "additive",
      messaging_conversations_started: "additive",
      results: "additive",
      revenue: "additive",
      conversations: "additive",
      reach: "unique_non_additive",
      frequency: "unique_non_additive",
      ctr: "ratio",
      ctr_link: "ratio",
      cpc: "ratio",
      cpm: "ratio",
      cpa: "ratio",
      cpl: "ratio",
      roas: "ratio",
      cost_per_result: "ratio",
      cost_per_conversation: "ratio",
      // sem denominador de peso armazenado -> conservador, não weighted_avg
      video_avg_time_watched: "unique_non_additive",
    };
    for (const [id, cls] of Object.entries(expected)) {
      expect(getMetricDefinition(id)?.aggregationClass, id).toBe(cls);
    }
    // placeholder de arquitetura: sem semântica matemática
    expect(getMetricDefinition("performance_trend")?.aggregationClass).toBeUndefined();
  });

  it("nenhuma métrica additive é periodic_only, e não-somáveis nunca são additive", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.aggregationClass === "additive") {
        expect(m.periodSource, `${m.id} additive + periodic_only`).not.toBe(
          "periodic_only",
        );
      }
    }
    for (const id of [
      "reach",
      "frequency",
      "video_avg_time_watched",
      "ctr",
      "cpc",
      "cpm",
      "cpa",
      "roas",
      "cost_per_result",
    ]) {
      expect(getMetricDefinition(id)?.aggregationClass, id).not.toBe("additive");
    }
  });

  it("isMetricAdditive: resultado idêntico ao critério antigo (aggregation === 'sum') para todas as métricas atuais", () => {
    for (const m of METRIC_REGISTRY) {
      expect(isMetricAdditive(m.id), m.id).toBe(m.aggregation === "sum");
    }
  });
});

describe("registry V2 — chart roles", () => {
  it("timeseries e kpi disponíveis para toda métrica real (exclui placeholder bernal)", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.availability === "bernal_planned") continue;
      expect(m.chartRoles, m.id).toContain("timeseries");
      expect(m.chartRoles, m.id).toContain("kpi");
    }
  });

  it("categorical (pizza/donut) só para métricas somáveis", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.chartRoles.includes("categorical")) {
        expect(m.aggregationClass, m.id).toBe("additive");
      }
    }
  });

  it("role 'funnel' <=> funnelEligible", () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.chartRoles.includes("funnel"), m.id).toBe(m.funnelEligible);
    }
  });

  it("visualizations V1 continuam intactas (line/area/bar/horizontal_bar)", () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.visualizations).toEqual(["line", "area", "bar", "horizontal_bar"]);
    }
  });
});

describe("registry V2 — funnel eligibility", () => {
  it("ratios / reach / frequency / spend NÃO entram em funil", () => {
    for (const id of [
      "ctr",
      "ctr_link",
      "cpc",
      "cpm",
      "cpa",
      "cpl",
      "roas",
      "cost_per_result",
      "frequency",
      "reach",
      "spend",
      "revenue",
      "video_avg_time_watched",
    ]) {
      expect(getMetricDefinition(id)?.funnelEligible, id).toBe(false);
    }
  });

  it("volume/eventos são elegíveis a funil", () => {
    for (const id of [
      "impressions",
      "clicks",
      "inline_link_clicks",
      "leads",
      "purchases",
      "messaging_conversations_started",
      "landing_page_views",
      "add_to_cart",
      "initiate_checkout",
      "results",
    ]) {
      expect(getMetricDefinition(id)?.funnelEligible, id).toBe(true);
    }
  });
});

describe("registry V2 — dependências", () => {
  it("getMetricDependencies deriva dos operandos da fórmula", () => {
    expect(getMetricDependencies("ctr").sort()).toEqual(["clicks", "impressions"]);
    expect(getMetricDependencies("cpa").sort()).toEqual(["purchases", "spend"]);
    expect(getMetricDependencies("roas").sort()).toEqual(["revenue", "spend"]);
    expect(getMetricDependencies("conversations")).toEqual([
      "messaging_conversations_started",
    ]);
  });
  it("métrica de coluna não tem dependências", () => {
    expect(getMetricDependencies("spend")).toEqual([]);
    expect(getMetricDependencies("impressions")).toEqual([]);
  });
});

describe("registry V2 — compatibilidade com dashboard_configs", () => {
  it("todo ResultMetricType (exceto 'custom') resolve no registry", () => {
    for (const type of Object.keys(RESULT_METRIC_PRESETS)) {
      if (type === "custom") continue;
      expect(getMetricDefinition(resolveMetricId(type)), type).toBeDefined();
    }
  });

  it("result_metric config-driven continua marcado", () => {
    expect(getMetricDefinition("results")?.configDriven).toBe(true);
    expect(getMetricDefinition("results")?.followsClientResultMetric).toBe(true);
    expect(getMetricDefinition("cost_per_result")?.configDriven).toBe(true);
  });

  it("conversões canônicas (raw_actions) continuam action-backed e contáveis", () => {
    for (const id of [
      "leads",
      "purchases",
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
      "registrations",
      "appointments",
    ]) {
      const def = getMetricDefinition(id)!;
      expect(def.source.kind, id).toBe("action");
      expect(def.aggregationClass, id).toBe("additive");
      expect(def.unit, id).toBe("count");
    }
  });
});
