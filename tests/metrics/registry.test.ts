import { describe, expect, it } from "vitest";
import {
  METRIC_REGISTRY,
  getMetricDefinition,
  isMetricCompatibleWithLevel,
  metricsByCategory,
  resolveMetricId,
  type MetricDefinition,
} from "@/lib/metrics/registry";
import {
  CARD_CATALOG,
  CHART_METRIC_CATALOG,
} from "@/lib/dashboard-config";

const FORMATS = new Set(["currency", "number", "percent", "decimal"]);
const BEHAVIORS = new Set([
  "higher_is_better",
  "lower_is_better",
  "neutral",
  "contextual",
]);
const LEVELS = new Set([
  "account",
  "campaign",
  "adset",
  "ad",
  "creative_analysis",
]);
const VIS = new Set(["line", "area", "bar", "horizontal_bar"]);
const CATEGORIES = new Set(["meta_native", "calculated", "bernal"]);

describe("integridade do registry", () => {
  it("ids únicos", () => {
    const ids = METRIC_REGISTRY.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("cada métrica tem forma válida", () => {
    for (const m of METRIC_REGISTRY) {
      expect(CATEGORIES.has(m.category), m.id).toBe(true);
      expect(FORMATS.has(m.format), m.id).toBe(true);
      expect(BEHAVIORS.has(m.behavior), m.id).toBe(true);
      expect(m.levels.length, m.id).toBeGreaterThan(0);
      expect(m.levels.every((l) => LEVELS.has(l)), m.id).toBe(true);
      expect(m.visualizations.every((v) => VIS.has(v)), m.id).toBe(true);
      expect(typeof m.requiresEvent, m.id).toBe("boolean");
      expect(typeof m.isDerived, m.id).toBe("boolean");
    }
  });

  it("as três categorias existem", () => {
    expect(metricsByCategory("meta_native").length).toBeGreaterThan(0);
    expect(metricsByCategory("calculated").length).toBeGreaterThan(0);
    expect(metricsByCategory("bernal").length).toBeGreaterThan(0);
  });

  it("fórmulas só referenciam métricas existentes (e sem ciclo direto)", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.source.kind !== "formula") continue;
      const f = m.source.formula;
      const refs = [
        f.numerator,
        f.denominator,
        f.of,
        ...(f.operands ?? []),
      ].filter((x): x is string => Boolean(x));
      for (const ref of refs) {
        expect(getMetricDefinition(ref), `${m.id} -> ${ref}`).toBeDefined();
        expect(ref, `${m.id} refere a si mesmo`).not.toBe(m.id);
      }
    }
  });

  it("métricas action-backed são requiresEvent + depends_on_account", () => {
    for (const m of METRIC_REGISTRY) {
      if (m.source.kind !== "action") continue;
      if (m.id === "results") continue; // resolvido via config do cliente
      expect(m.requiresEvent, m.id).toBe(true);
      expect(m.availability, m.id).toBe("depends_on_account");
    }
  });

  it("`results` segue o comportamento da métrica principal do cliente", () => {
    const results = getMetricDefinition("results") as MetricDefinition;
    expect(results.followsClientResultMetric).toBe(true);
  });

  it("`reach` não é somável (aggregation != sum)", () => {
    expect(getMetricDefinition("reach")?.aggregation).not.toBe("sum");
  });

  it("níveis honestos: métricas de vídeo não existem em account", () => {
    expect(isMetricCompatibleWithLevel("hook_rate", "account")).toBe(false);
    expect(isMetricCompatibleWithLevel("hook_rate", "ad")).toBe(true);
    expect(isMetricCompatibleWithLevel("spend", "creative_analysis")).toBe(true);
  });
});

describe("compatibilidade com o editor de dashboard (dashboard-config)", () => {
  it("todo id de gráfico do editor existe no registry com mesmo format/behavior", () => {
    for (const entry of CHART_METRIC_CATALOG) {
      const def = getMetricDefinition(resolveMetricId(entry.key));
      expect(def, entry.key).toBeDefined();
      expect(def!.format, `${entry.key}.format`).toBe(entry.format);
      expect(def!.behavior, `${entry.key}.behavior`).toBe(entry.behavior);
      expect(def!.dashboardSurfaces, `${entry.key}.surfaces`).toContain("chart");
    }
  });

  it("todo id de card do editor resolve no registry e é exposto como card", () => {
    for (const entry of CARD_CATALOG) {
      const def = getMetricDefinition(resolveMetricId(entry.key));
      expect(def, entry.key).toBeDefined();
      expect(def!.dashboardSurfaces, `${entry.key}`).toContain("card");
    }
  });

  it("o alias investment -> spend funciona", () => {
    expect(resolveMetricId("investment")).toBe("spend");
    expect(getMetricDefinition("investment")?.id).toBe("spend");
  });

  it("compatibleVisualizations do editor ⊆ visualizações do registry", async () => {
    const { compatibleVisualizations } = await import("@/lib/dashboard-config");
    for (const entry of CHART_METRIC_CATALOG) {
      const def = getMetricDefinition(resolveMetricId(entry.key))!;
      for (const v of compatibleVisualizations(entry.key)) {
        expect(def.visualizations, `${entry.key}:${v}`).toContain(v);
      }
    }
  });
});
