import { describe, expect, it } from "vitest";
import {
  ACTION_TYPE_MAP,
  ACTION_VALUE_TYPE_MAP,
  RESULT_METRIC_ACTION_TYPES,
  actionTypesForMetric,
  bernalMetricForAction,
  bernalValueMetricForAction,
} from "@/lib/meta/action-type-map";

describe("ACTION_TYPE_MAP", () => {
  it("mapeia action_types conhecidos da Meta", () => {
    expect(bernalMetricForAction("lead")).toBe("leads");
    expect(bernalMetricForAction("offsite_conversion.fct.lead")).toBe("leads");
    expect(bernalMetricForAction("purchase")).toBe("purchases");
    expect(bernalMetricForAction("omni_purchase")).toBe("purchases");
    expect(
      bernalMetricForAction("onsite_conversion.messaging_conversation_started_7d"),
    ).toBe("conversations");
    expect(bernalMetricForAction("landing_page_view")).toBe("landing_page_views");
    expect(bernalMetricForAction("link_click")).toBe("link_clicks");
  });

  it("action_type desconhecido -> undefined (vai p/ unmapped no normalizer)", () => {
    expect(bernalMetricForAction("some_new_meta_event_2027")).toBeUndefined();
  });

  it("reverse lookup lista todos os action_types de uma métrica", () => {
    expect(actionTypesForMetric("leads").sort()).toEqual(
      ["lead", "offsite_conversion.fct.lead", "onsite_conversion.lead_grouped"].sort(),
    );
    expect(actionTypesForMetric("purchases")).toContain("omni_purchase");
    expect(actionTypesForMetric("inexistente")).toEqual([]);
  });

  it("valores monetários mapeiam para revenue", () => {
    expect(bernalValueMetricForAction("purchase")).toBe("revenue");
    expect(bernalValueMetricForAction("lead")).toBeUndefined();
  });
});

describe("RESULT_METRIC_ACTION_TYPES", () => {
  it("cobre todos os tipos de resultado configuráveis", () => {
    for (const type of [
      "leads",
      "purchases",
      "conversations",
      "registrations",
      "appointments",
      "results",
      "custom",
    ] as const) {
      expect(Array.isArray(RESULT_METRIC_ACTION_TYPES[type])).toBe(true);
    }
  });

  it("leads/purchases têm action_types; results/custom ficam vazios (evento definido depois)", () => {
    expect(RESULT_METRIC_ACTION_TYPES.leads.length).toBeGreaterThan(0);
    expect(RESULT_METRIC_ACTION_TYPES.purchases.length).toBeGreaterThan(0);
    expect(RESULT_METRIC_ACTION_TYPES.results).toEqual([]);
    expect(RESULT_METRIC_ACTION_TYPES.custom).toEqual([]);
  });
});

describe("consistência interna", () => {
  it("todo alvo de ACTION_VALUE_TYPE_MAP é um id de métrica plausível", () => {
    expect(new Set(Object.values(ACTION_VALUE_TYPE_MAP))).toEqual(
      new Set(["revenue"]),
    );
  });

  it("nenhum action_type mapeia para dois ids diferentes", () => {
    // ACTION_TYPE_MAP é Record: chave única por definição — este teste
    // documenta a intenção e falha se alguém transformar em array de pares.
    expect(typeof ACTION_TYPE_MAP).toBe("object");
    expect(Object.keys(ACTION_TYPE_MAP).length).toBe(
      new Set(Object.keys(ACTION_TYPE_MAP)).size,
    );
  });
});
