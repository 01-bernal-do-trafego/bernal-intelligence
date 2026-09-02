import { describe, expect, it } from "vitest";
import {
  ACTION_METRIC_SPECS,
  ACTION_VALUE_METRIC_SPECS,
  RESULT_METRIC_ACTION_TYPES,
  actionTypesForMetric,
  bernalMetricForAction,
  bernalValueMetricForAction,
  combineForMetric,
  isKnownActionType,
  resolveActionMetric,
  resolveResultMetric,
} from "@/lib/meta/action-type-map";

describe("ACTION_METRIC_SPECS", () => {
  it("mapeia action_types conhecidos da Meta para métricas Bernal", () => {
    expect(bernalMetricForAction("lead")).toBe("leads");
    expect(bernalMetricForAction("offsite_conversion.fct.lead")).toBe("leads");
    expect(bernalMetricForAction("purchase")).toBe("purchases");
    expect(bernalMetricForAction("omni_purchase")).toBe("purchases");
    expect(
      bernalMetricForAction("onsite_conversion.messaging_conversation_started_7d"),
    ).toBe("messaging_conversations_started");
    expect(
      bernalMetricForAction("onsite_conversion.total_messaging_connection"),
    ).toBe("messaging_contacts_total");
    expect(
      bernalMetricForAction("onsite_conversion.messaging_first_reply"),
    ).toBe("messaging_contacts_new");
    expect(bernalMetricForAction("landing_page_view")).toBe("landing_page_views");
    expect(bernalMetricForAction("link_click")).toBe("link_clicks");
  });

  it("mensageria: 3 eventos DISTINTOS, cada um 1:1 (não aliases entre si)", () => {
    // evidência real (Atacado do Chinelo) + Ads Manager: 661 / 620 / 499.
    const ids = [
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
    ];
    for (const id of ids) {
      expect(actionTypesForMetric(id)).toHaveLength(1);
      expect(combineForMetric(id)).toBe("priority");
    }
    // nenhum action_type de um alimenta o outro
    const allTypes = ids.flatMap(actionTypesForMetric);
    expect(new Set(allTypes).size).toBe(3);
  });

  it("action_type desconhecido -> undefined (vira unmapped no normalizer)", () => {
    expect(bernalMetricForAction("some_new_meta_event_2027")).toBeUndefined();
    expect(isKnownActionType("some_new_meta_event_2027")).toBe(false);
    expect(isKnownActionType("omni_purchase")).toBe(true);
  });

  it("reverse lookup devolve os action_types EM ORDEM DE PRIORIDADE", () => {
    expect(actionTypesForMetric("leads")).toEqual([
      "lead",
      "offsite_conversion.fct.lead",
      "onsite_conversion.lead_grouped",
    ]);
    expect(actionTypesForMetric("purchases")[0]).toBe("omni_purchase");
    expect(actionTypesForMetric("inexistente")).toEqual([]);
  });

  it("todo spec tem combine explícito e default é priority (sem soma de aliases)", () => {
    for (const spec of ACTION_METRIC_SPECS) {
      expect(["priority", "sum"], spec.metricId).toContain(spec.combine);
      // hoje NENHUM grupo é aditivo — todos são aliases/superconjuntos.
      expect(spec.combine, `${spec.metricId} não deve somar aliases`).toBe(
        "priority",
      );
    }
    expect(combineForMetric("purchases")).toBe("priority");
  });

  it("valores monetários usam a mesma prioridade e alvo revenue", () => {
    expect(bernalValueMetricForAction("purchase")).toBe("revenue");
    expect(bernalValueMetricForAction("omni_purchase")).toBe("revenue");
    expect(bernalValueMetricForAction("lead")).toBeUndefined();
    expect(new Set(ACTION_VALUE_METRIC_SPECS.map((s) => s.metricId))).toEqual(
      new Set(["revenue"]),
    );
  });
});

describe("resolveActionMetric — anti dupla contagem", () => {
  it("priority: usa o PRIMEIRO action_type presente, nunca a soma", () => {
    const present = new Map([
      ["omni_purchase", 8],
      ["purchase", 5],
      ["offsite_conversion.fct.purchase", 5],
    ]);
    // sem prioridade seria 18 (dupla/tripla contagem)
    expect(
      resolveActionMetric(actionTypesForMetric("purchases"), present, "priority"),
    ).toBe(8);
  });

  it("priority: cai para o próximo quando o primeiro não veio", () => {
    const present = new Map([
      ["purchase", 5],
      ["offsite_conversion.fct.purchase", 5],
    ]);
    expect(
      resolveActionMetric(actionTypesForMetric("purchases"), present, "priority"),
    ).toBe(5);
  });

  it("priority: respeita valor 0 explícito do primeiro (zero medido é dado)", () => {
    const present = new Map([
      ["omni_purchase", 0],
      ["purchase", 5],
    ]);
    expect(
      resolveActionMetric(actionTypesForMetric("purchases"), present, "priority"),
    ).toBe(0);
  });

  it("nenhum action_type presente -> null (ausência, não zero)", () => {
    expect(
      resolveActionMetric(actionTypesForMetric("purchases"), new Map(), "priority"),
    ).toBeNull();
  });

  it("sum: só soma quando explicitamente pedido", () => {
    const present = new Map([
      ["a", 3],
      ["b", 4],
    ]);
    expect(resolveActionMetric(["a", "b"], present, "sum")).toBe(7);
  });

  it("dupla contagem de LEAD: lead=40 + offsite lead=40 + grouped=40 => 40, não 120", () => {
    const present = new Map([
      ["lead", 40],
      ["offsite_conversion.fct.lead", 40],
      ["onsite_conversion.lead_grouped", 40],
    ]);
    expect(resolveActionMetric(actionTypesForMetric("leads"), present, "priority")).toBe(40);
  });

  it("mensageria NÃO é alias: cada métrica resolve seu próprio evento", () => {
    const present = new Map([
      ["onsite_conversion.messaging_conversation_started_7d", 620],
      ["onsite_conversion.total_messaging_connection", 661],
      ["onsite_conversion.messaging_first_reply", 499],
    ]);
    expect(
      resolveActionMetric(
        actionTypesForMetric("messaging_conversations_started"),
        present,
        "priority",
      ),
    ).toBe(620);
    expect(
      resolveActionMetric(
        actionTypesForMetric("messaging_contacts_total"),
        present,
        "priority",
      ),
    ).toBe(661);
    expect(
      resolveActionMetric(
        actionTypesForMetric("messaging_contacts_new"),
        present,
        "priority",
      ),
    ).toBe(499);
    // o `conversations` genérico NÃO é um spec de action (é fórmula/identidade)
    expect(actionTypesForMetric("conversations")).toEqual([]);
  });

  it("omni_purchase presente vence purchase e offsite (mesmo com valores diferentes)", () => {
    const present = new Map([
      ["omni_purchase", 9],
      ["purchase", 7],
      ["offsite_conversion.fct.purchase", 7],
    ]);
    expect(
      resolveActionMetric(actionTypesForMetric("purchases"), present, "priority"),
    ).toBe(9);
  });
});

describe("RESULT_METRIC_ACTION_TYPES", () => {
  it("cobre todos os tipos de resultado configuráveis", () => {
    for (const type of [
      "leads",
      "purchases",
      "conversations",
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
      "registrations",
      "appointments",
      "results",
      "custom",
    ] as const) {
      expect(Array.isArray(RESULT_METRIC_ACTION_TYPES[type])).toBe(true);
    }
  });

  it("leads/purchases têm action_types; results/custom ficam vazios", () => {
    expect(RESULT_METRIC_ACTION_TYPES.leads.length).toBeGreaterThan(0);
    expect(RESULT_METRIC_ACTION_TYPES.purchases.length).toBeGreaterThan(0);
    expect(RESULT_METRIC_ACTION_TYPES.results).toEqual([]);
    expect(RESULT_METRIC_ACTION_TYPES.custom).toEqual([]);
  });

  it("cada tipo de mensageria aponta para 1 action_type próprio", () => {
    expect(RESULT_METRIC_ACTION_TYPES.messaging_conversations_started).toEqual([
      "onsite_conversion.messaging_conversation_started_7d",
    ]);
    expect(RESULT_METRIC_ACTION_TYPES.messaging_contacts_total).toEqual([
      "onsite_conversion.total_messaging_connection",
    ]);
    expect(RESULT_METRIC_ACTION_TYPES.messaging_contacts_new).toEqual([
      "onsite_conversion.messaging_first_reply",
    ]);
    // `conversations` legado resolve como "conversas iniciadas"
    expect(RESULT_METRIC_ACTION_TYPES.conversations).toEqual([
      "onsite_conversion.messaging_conversation_started_7d",
    ]);
  });

  it("resolveResultMetric separa os 3 tipos de mensageria com os mesmos totais", () => {
    const present = new Map([
      ["onsite_conversion.messaging_conversation_started_7d", 620],
      ["onsite_conversion.total_messaging_connection", 661],
      ["onsite_conversion.messaging_first_reply", 499],
    ]);
    expect(resolveResultMetric("messaging_conversations_started", present)).toBe(620);
    expect(resolveResultMetric("messaging_contacts_total", present)).toBe(661);
    expect(resolveResultMetric("messaging_contacts_new", present)).toBe(499);
  });

  it("resolveResultMetric usa prioridade (não soma lead + offsite lead)", () => {
    const present = new Map([
      ["lead", 40],
      ["offsite_conversion.fct.lead", 12],
    ]);
    expect(resolveResultMetric("leads", present)).toBe(40);
    expect(resolveResultMetric("results", present)).toBeNull(); // sem fonte definida
  });
});
