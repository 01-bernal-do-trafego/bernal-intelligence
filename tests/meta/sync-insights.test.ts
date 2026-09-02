import { describe, expect, it } from "vitest";
import {
  baseInsightToTotals,
  normalizeBaseInsight,
  sumDailyAdditive,
  type BaseInsightRow,
} from "@/lib/meta/sync-insights";
import { computeMetric } from "@/lib/metrics/compute";

const ACT = "act_555";

const rawDaily = (over: Record<string, unknown> = {}) => ({
  date_start: "2026-08-01",
  date_stop: "2026-08-01",
  account_id: "555",
  spend: "123.45",
  impressions: "10000",
  reach: "8000",
  clicks: "250",
  inline_link_clicks: "180",
  frequency: "1.25",
  ...over,
});

describe("normalizeBaseInsight", () => {
  it("nível account — extrai as métricas base e o entityId act_<n>", () => {
    const row = normalizeBaseInsight(rawDaily(), { level: "account", adAccountId: ACT });
    expect(row).toMatchObject({
      level: "account",
      entityId: "act_555",
      date: "2026-08-01",
      spend: 123.45,
      impressions: 10000,
      reach: 8000,
      clicks: 250,
      inlineLinkClicks: 180,
      frequency: 1.25,
    });
  });

  it("nível campaign/adset/ad — entityId é o id da entidade", () => {
    expect(
      normalizeBaseInsight(rawDaily({ campaign_id: "c1" }), { level: "campaign", adAccountId: ACT })?.entityId,
    ).toBe("c1");
    expect(
      normalizeBaseInsight(rawDaily({ campaign_id: "c1", adset_id: "s1" }), { level: "adset", adAccountId: ACT })?.entityId,
    ).toBe("s1");
    expect(
      normalizeBaseInsight(rawDaily({ campaign_id: "c1", adset_id: "s1", ad_id: "a1" }), { level: "ad", adAccountId: ACT })?.entityId,
    ).toBe("a1");
  });

  it("métricas ausentes viram null — nunca 0 inventado", () => {
    const row = normalizeBaseInsight(
      { date_start: "2026-08-02", account_id: "555", spend: "5" },
      { level: "account", adAccountId: ACT },
    );
    expect(row?.spend).toBe(5);
    expect(row?.impressions).toBeNull();
    expect(row?.reach).toBeNull();
    expect(row?.clicks).toBeNull();
    expect(row?.frequency).toBeNull();
  });

  it("linha diária sem date_start => null; periódica sem date_start => ok", () => {
    expect(
      normalizeBaseInsight({ account_id: "555", spend: "1" }, { level: "account", adAccountId: ACT }),
    ).toBeNull();
    const periodic = normalizeBaseInsight(
      { account_id: "555", spend: "1", date_stop: "2026-08-30" },
      { level: "account", adAccountId: ACT, periodic: true },
    );
    expect(periodic?.date).toBeNull();
    expect(periodic?.spend).toBe(1);
  });

  it("é determinístico — mesma entrada, mesma saída (sync repetida não muda linha)", () => {
    const a = normalizeBaseInsight(rawDaily(), { level: "account", adAccountId: ACT });
    const b = normalizeBaseInsight(rawDaily(), { level: "account", adAccountId: ACT });
    expect(a).toEqual(b);
  });
});

describe("sumDailyAdditive — reach NUNCA é somado", () => {
  const days: BaseInsightRow[] = [
    normalizeBaseInsight(rawDaily({ date_start: "2026-08-01", reach: "8000", spend: "100", impressions: "10000", clicks: "200", inline_link_clicks: "150" }), { level: "account", adAccountId: ACT })!,
    normalizeBaseInsight(rawDaily({ date_start: "2026-08-02", reach: "7000", spend: "50", impressions: "6000", clicks: "120", inline_link_clicks: "90" }), { level: "account", adAccountId: ACT })!,
  ];

  it("soma só as aditivas", () => {
    expect(sumDailyAdditive(days)).toEqual({
      spend: 150,
      impressions: 16000,
      clicks: 320,
      inlineLinkClicks: 240,
    });
  });

  it("o retorno não tem reach nem frequency", () => {
    const out = sumDailyAdditive(days) as unknown as Record<string, unknown>;
    expect("reach" in out).toBe(false);
    expect("frequency" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual([
      "clicks",
      "impressions",
      "inlineLinkClicks",
      "spend",
    ]);
  });

  it("null quando nenhuma linha tem o campo", () => {
    const noSpend: BaseInsightRow[] = [
      normalizeBaseInsight({ date_start: "2026-08-01", account_id: "555", clicks: "10" }, { level: "account", adAccountId: ACT })!,
    ];
    expect(sumDailyAdditive(noSpend).spend).toBeNull();
    expect(sumDailyAdditive(noSpend).clicks).toBe(10);
  });
});

describe("CTR / CPC / CPM sobre TOTAIS BRUTOS (não média de diário)", () => {
  it("usa os totais do período — não a média dos dias", () => {
    // dia 1: CTR 2% ; dia 2: CTR 2% ; total: 320/16000 = 2%
    const totals = baseInsightToTotals(
      normalizeBaseInsight(
        { date_start: "2026-08-01", account_id: "555", spend: "150", impressions: "16000", reach: "12000", clicks: "320" },
        { level: "account", adAccountId: ACT, periodic: true },
      )!,
    );
    expect(computeMetric("ctr", totals)).toBeCloseTo(2, 6);
    expect(computeMetric("cpc", totals)).toBeCloseTo(150 / 320, 6);
    expect(computeMetric("cpm", totals)).toBeCloseTo((150 / 16000) * 1000, 6);
  });

  it("frequency = impressões/alcance da MESMA linha periódica", () => {
    const totals = baseInsightToTotals(
      normalizeBaseInsight(
        { date_start: "2026-08-01", account_id: "555", impressions: "16000", reach: "8000" },
        { level: "account", adAccountId: ACT, periodic: true },
      )!,
    );
    expect(computeMetric("frequency", totals)).toBeCloseTo(2, 6);
  });

  it("total ausente => métrica null (nunca 0/NaN)", () => {
    const totals = baseInsightToTotals(
      normalizeBaseInsight(
        { date_start: "2026-08-01", account_id: "555", spend: "10" },
        { level: "account", adAccountId: ACT, periodic: true },
      )!,
    );
    expect(computeMetric("ctr", totals)).toBeNull();
    expect(computeMetric("cpc", totals)).toBeNull();
  });
});
