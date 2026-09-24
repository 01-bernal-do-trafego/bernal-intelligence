/**
 * FEATURE 02A — item 10: formatação coerente do gráfico (eixo/tooltip/legenda).
 *
 * `components/charts/dashboard-chart.tsx` agora repassa `entry.format`
 * (CHART_METRIC_CATALOG, derivado do Registry) DIRETO para `TrendChart`
 * (`format = entry?.format ?? "number"`, sem colapsar tudo que não é
 * "currency" em "number" cru — o bug encontrado na auditoria). Este arquivo
 * prova que o dado-fonte (`chartMetricEntry`) tem o `format` correto por
 * família de métrica — é o que `DashboardChart` repassa sem transformação,
 * então testar a fonte cobre o caminho inteiro sem precisar renderizar SVG
 * do Recharts.
 */
import { describe, expect, it } from "vitest";
import { CHART_METRIC_CATALOG, chartMetricEntry } from "@/lib/dashboard-config";

describe("FEATURE 02A — formato correto por família de métrica no gráfico", () => {
  it("percent: CTR e CTR (link)", () => {
    expect(chartMetricEntry("ctr")?.format).toBe("percent");
    expect(chartMetricEntry("ctr_link")?.format).toBe("percent");
  });

  it("currency: investimento, CPC, CPM, CPA, CPL, custos novos", () => {
    for (const key of [
      "spend",
      "cpc",
      "cpc_link",
      "cpm",
      "cpa",
      "cpl",
      "cost_per_result",
      "cost_per_conversation",
      "cost_per_landing_page_view",
      "cost_per_add_to_cart",
      "cost_per_initiate_checkout",
      "cost_per_video_view",
      "revenue",
    ]) {
      expect(chartMetricEntry(key)?.format, key).toBe("currency");
    }
  });

  it("decimal: ROAS e frequência — nunca number cru", () => {
    expect(chartMetricEntry("roas")?.format).toBe("decimal");
    expect(chartMetricEntry("frequency")?.format).toBe("decimal");
  });

  it("number: contagens simples (impressões, cliques, leads, compras, engajamento...)", () => {
    for (const key of [
      "impressions",
      "clicks",
      "inline_link_clicks",
      "reach",
      "leads",
      "purchases",
      "add_to_cart",
      "initiate_checkout",
      "landing_page_views",
      "post_engagement",
      "post_reactions",
      "post_comments",
      "post_saves",
      "video_views",
    ]) {
      expect(chartMetricEntry(key)?.format, key).toBe("number");
    }
  });

  it("todo format do catálogo de gráfico é um dos 4 valores válidos (nenhum futuro tipo escapou)", () => {
    const VALID = new Set(["currency", "number", "percent", "decimal"]);
    for (const entry of CHART_METRIC_CATALOG) {
      expect(VALID.has(entry.format), entry.key).toBe(true);
    }
  });
});
