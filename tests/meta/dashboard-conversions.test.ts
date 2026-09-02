import { describe, expect, it } from "vitest";
import {
  CONVERSION_METRIC_META,
  RELEASED_CONVERSION_METRICS,
  conversionMetricValue,
  sumRawMaps,
} from "@/lib/meta/dashboard-conversions";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import type { MetricTotals } from "@/lib/metrics/compute";

/** MetricTotals de um período/dia com eventos crus de mensageria. */
function totals(over: {
  spend?: number | null;
  started?: number;
  contactsTotal?: number;
  contactsNew?: number;
}): MetricTotals {
  const raw: Record<string, number> = {};
  if (over.started != null)
    raw["onsite_conversion.messaging_conversation_started_7d"] = over.started;
  if (over.contactsTotal != null)
    raw["onsite_conversion.total_messaging_connection"] = over.contactsTotal;
  if (over.contactsNew != null)
    raw["onsite_conversion.messaging_first_reply"] = over.contactsNew;
  return conversionTotalsFromRow({
    spend: over.spend ?? null,
    raw_actions: raw,
    raw_action_values: {},
  });
}

describe("dashboard-conversions — métricas de conversão liberadas", () => {
  it("6 métricas: results, cost_per_result e as 4 de mensageria", () => {
    expect(new Set(RELEASED_CONVERSION_METRICS)).toEqual(
      new Set([
        "results",
        "cost_per_result",
        "messaging_conversations_started",
        "cost_per_conversation",
        "messaging_contacts_total",
        "messaging_contacts_new",
      ]),
    );
  });

  it("Total de contatos e Novos contatos são INDEPENDENTES (sem fallback entre si)", () => {
    const t = totals({ spend: 1000, contactsTotal: 661, contactsNew: 499 });
    expect(conversionMetricValue("messaging_contacts_total", t, "results")).toBe(661);
    expect(conversionMetricValue("messaging_contacts_new", t, "results")).toBe(499);
    // só "novos" presente -> "total" NÃO herda o valor
    const onlyNew = totals({ spend: 1000, contactsNew: 12 });
    expect(conversionMetricValue("messaging_contacts_new", onlyNew, "results")).toBe(12);
    expect(conversionMetricValue("messaging_contacts_total", onlyNew, "results")).toBeNull();
  });

  it("Results segue result_metric — troca o tipo, muda o valor SEM re-sync", () => {
    const t = totals({
      spend: 1000,
      started: 620,
      contactsTotal: 661,
      contactsNew: 499,
    });
    expect(conversionMetricValue("results", t, "messaging_conversations_started")).toBe(620);
    expect(conversionMetricValue("results", t, "messaging_contacts_new")).toBe(499);
    expect(conversionMetricValue("results", t, "messaging_contacts_total")).toBe(661);
    // sem canônica -> null (nunca "chuta" outra métrica)
    expect(conversionMetricValue("results", t, "results")).toBeNull();
    expect(conversionMetricValue("results", t, "custom")).toBeNull();
  });

  it("Custo por resultado = spend TOTAL / resultado TOTAL (não média de diários)", () => {
    // dois dias: (300/20) e (700/60). Média dos custos diários = 13.33.
    // spend total 1000 / resultado total 80 = 12.5 -> este é o valor correto.
    const period = totals({ spend: 1000, started: 80 });
    expect(
      conversionMetricValue("cost_per_result", period, "messaging_conversations_started"),
    ).toBeCloseTo(12.5, 6);
  });

  it("Custo por conversa iniciada diário = spend do dia / conversas do dia", () => {
    const d1 = totals({ spend: 300, started: 20 });
    const d2 = totals({ spend: 700, started: 60 });
    expect(conversionMetricValue("cost_per_conversation", d1, "results")).toBeCloseTo(15, 6);
    expect(conversionMetricValue("cost_per_conversation", d2, "results")).toBeCloseTo(
      700 / 60,
      6,
    );
  });

  it("séries diárias: conversas iniciadas / total / novos por dia", () => {
    const d = totals({ spend: 100, started: 7, contactsTotal: 9, contactsNew: 5 });
    expect(conversionMetricValue("messaging_conversations_started", d, "results")).toBe(7);
    expect(conversionMetricValue("messaging_contacts_total", d, "results")).toBe(9);
    expect(conversionMetricValue("messaging_contacts_new", d, "results")).toBe(5);
    expect(conversionMetricValue("cost_per_result", d, "messaging_contacts_new")).toBeCloseTo(
      20,
      6,
    );
  });

  it("null (evento ausente) ≠ 0 (evento medido com zero)", () => {
    const ausente = totals({ spend: 500 }); // nenhum evento
    expect(conversionMetricValue("messaging_conversations_started", ausente, "results")).toBeNull();
    expect(conversionMetricValue("messaging_contacts_total", ausente, "results")).toBeNull();

    const zero = totals({ spend: 500, started: 0 });
    expect(conversionMetricValue("messaging_conversations_started", zero, "results")).toBe(0);
    // custo com denominador 0 -> 0 (safeDivide protege), não NaN
    expect(conversionMetricValue("cost_per_conversation", zero, "results")).toBe(0);
  });

  it("cliente/ período sem o evento -> indisponível (null), nunca 0 inventado", () => {
    const t = totals({ spend: 800 });
    for (const id of RELEASED_CONVERSION_METRICS) {
      expect(conversionMetricValue(id, t, "messaging_conversations_started")).toBeNull();
    }
  });

  it("metadados de formato/comportamento coerentes", () => {
    expect(CONVERSION_METRIC_META.results.followsResultMetricBehavior).toBe(true);
    expect(CONVERSION_METRIC_META.cost_per_result.format).toBe("currency");
    expect(CONVERSION_METRIC_META.cost_per_conversation.behavior).toBe("lower_is_better");
    expect(CONVERSION_METRIC_META.messaging_contacts_total.format).toBe("number");
  });
});

describe("sumRawMaps — soma de eventos crus por dia/conta", () => {
  it("soma chaves iguais, ignora não-numéricos, tolera null", () => {
    expect(
      sumRawMaps([
        { a: 1, b: 2 },
        { a: 3, c: 4 },
        null,
        { a: "x" as unknown as number },
        undefined,
      ]),
    ).toEqual({ a: 4, b: 2, c: 4 });
  });

  it("somar 3 dias de conversas iniciadas = total do período (fallback diário)", () => {
    const period = conversionTotalsFromRow({
      spend: 900,
      raw_actions: sumRawMaps([
        { "onsite_conversion.messaging_conversation_started_7d": 10 },
        { "onsite_conversion.messaging_conversation_started_7d": 20 },
        { "onsite_conversion.messaging_conversation_started_7d": 30 },
      ]),
      raw_action_values: {},
    });
    expect(
      conversionMetricValue("messaging_conversations_started", period, "results"),
    ).toBe(60);
    expect(
      conversionMetricValue("cost_per_conversation", period, "results"),
    ).toBeCloseTo(15, 6);
  });
});
