/**
 * 19. Paridade V1 — a Query Layer usa EXATAMENTE os mesmos primitivos puros
 * que `server/real-dashboard.ts` (sem tocar em banco/Supabase — fixture
 * representativa, conforme autorizado). Duas verificações por métrica:
 *
 *  (a) o valor bate com o esperado calculado à mão (comentado);
 *  (b) o valor bate com o mesmo cálculo feito chamando os primitivos do V1
 *      DIRETAMENTE (`conversionTotalsFromRow` + `computeMetric` +
 *      `withResolvedResults`) sobre a MESMA fonte de dados — prova de
 *      paridade de código, não só coincidência numérica.
 *
 * Cenário: 1 conta, período de 7 dias com um `meta_insights_periodic` exato
 * já sincronizado. Como em `real-dashboard.ts`, quando o periodic exato
 * existe ele é a fonte AUTORITATIVA dos totais (aditivas e conversões) — não
 * a soma das diárias. Por isso a soma diária abaixo é DELIBERADAMENTE
 * diferente do periodic (simula uma pequena defasagem/buraco de cobertura):
 * o teste prova que a Query Layer usa o periodic, exatamente como o V1.
 */
import { describe, expect, it } from "vitest";
import { resolveMetricTotals } from "@/lib/query/metric-totals";
import { computeMetric } from "@/lib/metrics/compute";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import { withResolvedResults } from "@/lib/meta/result-metric-resolve";
import { ACCOUNT_ID, SCOPE_SINGLE, dailyRow, periodicRow } from "./fixtures";

const RANGE = { from: "2026-08-25", to: "2026-08-31" }; // 7 dias

// soma das diárias (NÃO deve ser o que a Query Layer usa, pois há periodic exato)
const DAILY_SUM_SPEND = 250; // != 300 do periodic, de propósito
const dailyRows = [
  dailyRow({ date: "2026-08-25", spend: 40, impressions: 4000, clicks: 40, reach: 900 }),
  dailyRow({ date: "2026-08-26", spend: 30, impressions: 3000, clicks: 30, reach: 850 }),
  dailyRow({ date: "2026-08-27", spend: 30, impressions: 3000, clicks: 20, reach: 800 }),
  dailyRow({ date: "2026-08-28", spend: 30, impressions: 3000, clicks: 20, reach: 820 }),
  dailyRow({ date: "2026-08-29", spend: 40, impressions: 4000, clicks: 30, reach: 900 }),
  dailyRow({ date: "2026-08-30", spend: 40, impressions: 4000, clicks: 30, reach: 950 }),
  dailyRow({ date: "2026-08-31", spend: 40, impressions: 4000, clicks: 40, reach: 1000 }),
];
// linha periódica EXATA para o mesmo intervalo — fonte autoritativa
const PERIODIC_SPEND = 300;
const PERIODIC_IMPRESSIONS = 25000;
const PERIODIC_CLICKS = 260;
const PERIODIC_REACH = 6200;
const exactPeriodic = periodicRow({
  date_from: RANGE.from,
  date_to: RANGE.to,
  spend: PERIODIC_SPEND,
  impressions: PERIODIC_IMPRESSIONS,
  clicks: PERIODIC_CLICKS,
  reach: PERIODIC_REACH,
  raw_actions: { lead: 30, "onsite_conversion.messaging_conversation_started_7d": 12, omni_purchase: 4 },
  raw_action_values: { omni_purchase: 1800 },
});

const resultMetric = "leads" as const;

function queryLayerValue(metricId: string): number | null {
  const out = resolveMetricTotals({
    scope: SCOPE_SINGLE,
    range: RANGE,
    metricIds: [metricId],
    dailyRows,
    periodicRows: [exactPeriodic],
    resultMetric,
  });
  return out[0].value;
}

/** MESMO cálculo, chamando os primitivos do V1 diretamente (não a Query Layer). */
function v1PrimitiveValue(metricId: string): number | null {
  const totals = withResolvedResults(conversionTotalsFromRow(exactPeriodic), resultMetric);
  return computeMetric(metricId, totals);
}

describe("paridade V1 — totais vêm do periodic exato (não da soma diária)", () => {
  it("spend: Query Layer == primitivo V1 == periodic exato (não a soma diária de 250)", () => {
    expect(queryLayerValue("spend")).toBe(PERIODIC_SPEND);
    expect(queryLayerValue("spend")).toBe(v1PrimitiveValue("spend"));
    expect(queryLayerValue("spend")).not.toBe(DAILY_SUM_SPEND);
  });

  it("impressions", () => {
    expect(queryLayerValue("impressions")).toBe(PERIODIC_IMPRESSIONS);
    expect(queryLayerValue("impressions")).toBe(v1PrimitiveValue("impressions"));
  });

  it("reach — só existe via periodic (exact_periodic_only)", () => {
    expect(queryLayerValue("reach")).toBe(PERIODIC_REACH);
    expect(queryLayerValue("reach")).toBe(v1PrimitiveValue("reach"));
  });

  it("clicks", () => {
    expect(queryLayerValue("clicks")).toBe(PERIODIC_CLICKS);
    expect(queryLayerValue("clicks")).toBe(v1PrimitiveValue("clicks"));
  });

  it("CTR = clicks/impressions*100 sobre o periodic exato", () => {
    const expected = (PERIODIC_CLICKS / PERIODIC_IMPRESSIONS) * 100;
    expect(queryLayerValue("ctr")).toBeCloseTo(expected, 10);
    expect(queryLayerValue("ctr")).toBeCloseTo(v1PrimitiveValue("ctr") as number, 10);
  });

  it("CPC = spend/clicks", () => {
    const expected = PERIODIC_SPEND / PERIODIC_CLICKS;
    expect(queryLayerValue("cpc")).toBeCloseTo(expected, 10);
    expect(queryLayerValue("cpc")).toBeCloseTo(v1PrimitiveValue("cpc") as number, 10);
  });

  it("CPM = spend/impressions*1000", () => {
    const expected = (PERIODIC_SPEND / PERIODIC_IMPRESSIONS) * 1000;
    expect(queryLayerValue("cpm")).toBeCloseTo(expected, 10);
    expect(queryLayerValue("cpm")).toBeCloseTo(v1PrimitiveValue("cpm") as number, 10);
  });

  it("leads (raw_actions do periodic exato)", () => {
    expect(queryLayerValue("leads")).toBe(30);
    expect(queryLayerValue("leads")).toBe(v1PrimitiveValue("leads"));
  });

  it("messaging_conversations_started (conversations)", () => {
    expect(queryLayerValue("messaging_conversations_started")).toBe(12);
    expect(queryLayerValue("messaging_conversations_started")).toBe(
      v1PrimitiveValue("messaging_conversations_started"),
    );
  });

  it("results = leads (resultMetric configurado) e cost_per_result = spend/leads", () => {
    expect(queryLayerValue("results")).toBe(30);
    expect(queryLayerValue("results")).toBe(v1PrimitiveValue("results"));
    expect(queryLayerValue("cost_per_result")).toBeCloseTo(PERIODIC_SPEND / 30, 10);
    expect(queryLayerValue("cost_per_result")).toBeCloseTo(
      v1PrimitiveValue("cost_per_result") as number,
      10,
    );
  });

  it("revenue e ROAS (raw_action_values do periodic exato)", () => {
    expect(queryLayerValue("revenue")).toBe(1800);
    expect(queryLayerValue("roas")).toBeCloseTo(1800 / PERIODIC_SPEND, 10);
    expect(queryLayerValue("roas")).toBeCloseTo(v1PrimitiveValue("roas") as number, 10);
  });
});

describe("paridade V1 — sem periodic exato, cai para a soma diária (mesma regra do V1)", () => {
  it("spend = soma diária quando NÃO há periodic exato para o intervalo", () => {
    const out = resolveMetricTotals({
      scope: SCOPE_SINGLE,
      range: RANGE,
      metricIds: ["spend"],
      dailyRows,
      periodicRows: [], // nenhum periodic
    });
    expect(out[0].value).toBe(DAILY_SUM_SPEND);
  });
});

describe("identidade do escopo usada no fixture", () => {
  it("entidade única do escopo é a conta do fixture", () => {
    expect(SCOPE_SINGLE.entityIds).toEqual([ACCOUNT_ID]);
  });

  it("fixture consistente: a soma diária de spend é a esperada (250, != 300 do periodic)", () => {
    const sum = dailyRows.reduce((a, r) => a + (r.spend ?? 0), 0);
    expect(sum).toBe(DAILY_SUM_SPEND);
  });
});
