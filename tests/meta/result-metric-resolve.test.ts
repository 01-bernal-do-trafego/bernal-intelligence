import { describe, expect, it } from "vitest";
import {
  canonicalMetricForResult,
  resolveCostPerResult,
  resolveResults,
  withResolvedResults,
} from "@/lib/meta/result-metric-resolve";
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import { normalizeInsightRow, insightRowToTotals } from "@/lib/meta/normalizer";
import {
  CONFIG_DRIVEN_METRIC_IDS,
  isConfigDrivenMetric,
} from "@/lib/metrics/registry";

/** totais de um período com actions CANÔNICAS já resolvidas (como o banco guarda). */
function totals(over: Partial<MetricTotals> = {}): MetricTotals {
  return {
    spend: 1000,
    impressions: 40000,
    clicks: 600,
    inline_link_clicks: 500,
    reach: 20000,
    frequency: 2,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: {
      leads: 50,
      messaging_conversations_started: 20,
      messaging_contacts_total: 26,
      messaging_contacts_new: 14,
      purchases: 8,
      registrations: 12,
    },
    actionValues: { revenue: 3200 },
    ...over,
  };
}

describe("sync grava só métricas CANÔNICAS (não `results`)", () => {
  const rawAd = {
    date_start: "2026-08-10",
    account_id: "555",
    ad_id: "a1",
    campaign_id: "c1",
    adset_id: "s1",
    spend: "700",
    actions: [
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "42" },
      { action_type: "lead", value: "40" },
      { action_type: "omni_purchase", value: "7" },
      { action_type: "purchase", value: "7" },
    ],
    action_values: [{ action_type: "omni_purchase", value: "1400" }],
  };

  it("mensageria / leads / purchases canônicas são armazenadas", () => {
    for (const level of ["account", "campaign", "adset", "ad"] as const) {
      const row = normalizeInsightRow(rawAd, { level, adAccountId: "act_555" })!;
      expect(row.actions.messaging_conversations_started).toBe(42);
      expect(row.actions.leads).toBe(40);
      expect(row.actions.purchases).toBe(7); // prioridade: omni_purchase (não 14)
      expect(row.actionValues.revenue).toBe(1400);
      expect("results" in row.actions).toBe(false);
      // não grava mais um `conversations` genérico combinado
      expect("conversations" in row.actions).toBe(false);
    }
  });

  it("`results` nunca é persistido pelo normalizer/sync", () => {
    const t = insightRowToTotals(
      normalizeInsightRow(rawAd, { level: "account", adAccountId: "act_555" })!,
    );
    expect("results" in t.actions).toBe(false);
  });
});

describe("results resolvido EM LEITURA a partir de result_metric", () => {
  it("result_metric = conversations (legado) -> results = conversas iniciadas", () => {
    expect(canonicalMetricForResult("conversations")).toBe(
      "messaging_conversations_started",
    );
    expect(resolveResults(totals(), "conversations")).toBe(20);
  });
  it("result_metric = leads -> results = leads", () => {
    expect(resolveResults(totals(), "leads")).toBe(50);
  });
  it("result_metric = purchases -> results = purchases", () => {
    expect(resolveResults(totals(), "purchases")).toBe(8);
  });

  it("mensageria: os 3 tipos resolvem métricas SEPARADAS (não aliases)", () => {
    expect(canonicalMetricForResult("messaging_conversations_started")).toBe(
      "messaging_conversations_started",
    );
    expect(canonicalMetricForResult("messaging_contacts_total")).toBe(
      "messaging_contacts_total",
    );
    expect(canonicalMetricForResult("messaging_contacts_new")).toBe(
      "messaging_contacts_new",
    );
    const t = totals();
    expect(resolveResults(t, "messaging_conversations_started")).toBe(20);
    expect(resolveResults(t, "messaging_contacts_total")).toBe(26);
    expect(resolveResults(t, "messaging_contacts_new")).toBe(14);
  });

  it("mudar result_metric muda results SEM novo sync (mesmos totals)", () => {
    const t = totals(); // dados fixos, como se já sincronizados
    expect(resolveResults(t, "messaging_conversations_started")).toBe(20);
    expect(resolveResults(t, "messaging_contacts_total")).toBe(26);
    expect(resolveResults(t, "messaging_contacts_new")).toBe(14);
    expect(resolveResults(t, "leads")).toBe(50);
    expect(resolveResults(t, "purchases")).toBe(8);
  });

  it("cost_per_result recalcula com a nova config (spend / resultado)", () => {
    const t = totals({ spend: 1000 });
    expect(resolveCostPerResult(t, "messaging_conversations_started")).toBeCloseTo(1000 / 20, 6); // 50
    expect(resolveCostPerResult(t, "messaging_contacts_total")).toBeCloseTo(1000 / 26, 6);
    expect(resolveCostPerResult(t, "messaging_contacts_new")).toBeCloseTo(1000 / 14, 6);
    expect(resolveCostPerResult(t, "leads")).toBeCloseTo(1000 / 50, 6); // 20
    expect(resolveCostPerResult(t, "purchases")).toBeCloseTo(1000 / 8, 6); // 125
  });

  it("result_metric indisponível => null (nunca substitui por outra)", () => {
    // config = leads, mas a conta não teve leads no período
    const noLeads = totals({ actions: { purchases: 8 } });
    expect(resolveResults(noLeads, "leads")).toBeNull();
    expect(resolveCostPerResult(noLeads, "leads")).toBeNull();
    // tipos sem canônica
    expect(canonicalMetricForResult("results")).toBeNull();
    expect(canonicalMetricForResult("custom")).toBeNull();
    expect(resolveResults(totals(), "results")).toBeNull();
    expect(resolveResults(totals(), null)).toBeNull();
  });

  it("results = 0 medido (evento presente com zero) != ausência", () => {
    expect(resolveResults(totals({ actions: { leads: 0 } }), "leads")).toBe(0);
    expect(resolveCostPerResult(totals({ spend: 500, actions: { leads: 0 } }), "leads")).toBe(0);
  });
});

describe("withResolvedResults + Registry", () => {
  it("injeta results resolvido para reaproveitar computeMetric do Registry", () => {
    const t = withResolvedResults(totals(), "conversations");
    expect(computeMetric("results", t)).toBe(20);
    expect(computeMetric("cost_per_result", t)).toBeCloseTo(1000 / 20, 6);
    // sem resolver, o Registry não acha `results`
    expect(computeMetric("results", totals())).toBeNull();
  });

  it("Registry marca results / cost_per_result como config-driven", () => {
    expect(isConfigDrivenMetric("results")).toBe(true);
    expect(isConfigDrivenMetric("cost_per_result")).toBe(true);
    expect(isConfigDrivenMetric("leads")).toBe(false);
    expect(isConfigDrivenMetric("purchases")).toBe(false);
    expect(new Set(CONFIG_DRIVEN_METRIC_IDS)).toEqual(
      new Set(["results", "cost_per_result"]),
    );
  });
});

describe("sem regressão em unified_attribution", () => {
  it("o normalizer continua gravando attribution_window = unified_attribution", () => {
    const row = normalizeInsightRow(
      { date_start: "2026-08-10", account_id: "555", spend: "10" },
      { level: "account", adAccountId: "act_555" },
    )!;
    expect(row.attributionWindow).toBe("unified_attribution");
  });
});
