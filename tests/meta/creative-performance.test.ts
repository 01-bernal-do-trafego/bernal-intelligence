import { describe, expect, it } from "vitest";
import {
  buildCreativePerformance,
  type AdCreativeObservation,
  type AdDailyInsight,
  type AdForCreative,
  type CreativePerfInput,
} from "@/lib/meta/creative-performance";

const PERIOD = { start: "2026-08-01", end: "2026-08-31" };
const TODAY = "2026-09-05";

// janela larga o suficiente para os dias de agosto serem seguros
const OBS_WIDE = { firstSeen: "2026-07-01", lastSeen: "2026-09-04" };

function day(
  adId: string,
  date: string,
  spend: number,
  impressions: number,
  clicks: number,
  started?: number,
): AdDailyInsight {
  return {
    adId,
    date,
    spend,
    impressions,
    clicks,
    rawActions: started != null
      ? { "onsite_conversion.messaging_conversation_started_7d": started }
      : {},
    rawActionValues: {},
  };
}

function run(over: Partial<CreativePerfInput>): ReturnType<typeof buildCreativePerformance> {
  return buildCreativePerformance({
    period: PERIOD,
    today: TODAY,
    resultType: "messaging_conversations_started",
    ads: [],
    observations: [],
    dailyInsights: [],
    ...over,
  });
}

const ad = (adId: string, creativeId: string): AdForCreative => ({
  adId,
  currentCreativeId: creativeId,
  updatedDate: "2026-06-01",
  campaignId: "camp1",
  adsetId: "as1",
  name: `Ad ${adId}`,
});
const obs = (adId: string, creativeId: string): AdCreativeObservation => ({
  adId,
  creativeId,
  ...OBS_WIDE,
});

describe("buildCreativePerformance — agregação ad→creative", () => {
  it("1 ad -> 1 creative", () => {
    const rows = run({
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [day("a1", "2026-08-10", 100, 1000, 50, 5)],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].creativeId).toBe("CR1");
    expect(rows[0].adIds).toEqual(["a1"]);
    expect(rows[0].metrics.spend).toBe(100);
  });

  it("2 ads -> mesmo creative: 1 linha, sem duplicar", () => {
    const rows = run({
      ads: [ad("a1", "CR1"), ad("a2", "CR1")],
      observations: [obs("a1", "CR1"), obs("a2", "CR1")],
      dailyInsights: [
        day("a1", "2026-08-10", 100, 1000, 40, 4),
        day("a2", "2026-08-10", 300, 3000, 60, 6),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0].adIds)).toEqual(new Set(["a1", "a2"]));
    expect(rows[0].metrics.spend).toBe(400); // soma
    expect(rows[0].metrics.impressions).toBe(4000);
    expect(rows[0].metrics.clicks).toBe(100);
  });

  it("CTR/CPC/CPM recalculados sobre TOTAIS (nunca média por ad)", () => {
    const rows = run({
      ads: [ad("a1", "CR1"), ad("a2", "CR1")],
      observations: [obs("a1", "CR1"), obs("a2", "CR1")],
      dailyInsights: [
        day("a1", "2026-08-10", 100, 1000, 10), // CTR 1%
        day("a2", "2026-08-11", 900, 9000, 190), // CTR ~2.11%
      ],
    });
    // total: 200 clicks / 10000 impr = 2% ; 1000 spend / 200 clicks = 5 ; 1000/10000*1000 = 100
    expect(rows[0].metrics.ctr).toBeCloseTo(2, 6);
    expect(rows[0].metrics.cpc).toBeCloseTo(5, 6);
    expect(rows[0].metrics.cpm).toBeCloseTo(100, 6);
  });

  it("results é config-driven; trocar resultType muda o ranking SEM re-sync", () => {
    const args = {
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [
        {
          ...day("a1", "2026-08-10", 620, 10000, 300),
          rawActions: {
            "onsite_conversion.messaging_conversation_started_7d": 620,
            "onsite_conversion.total_messaging_connection": 661,
            "onsite_conversion.messaging_first_reply": 499,
          },
        },
      ],
    };
    const started = run({ ...args, resultType: "messaging_conversations_started" });
    expect(started[0].metrics.results).toBe(620);
    expect(started[0].metrics.cost_per_result).toBeCloseTo(1, 6); // 620/620

    const contactsNew = run({ ...args, resultType: "messaging_contacts_new" });
    expect(contactsNew[0].metrics.results).toBe(499);
    expect(contactsNew[0].metrics.cost_per_result).toBeCloseTo(620 / 499, 6);

    const contactsTotal = run({ ...args, resultType: "messaging_contacts_total" });
    expect(contactsTotal[0].metrics.results).toBe(661);
  });

  it("custo por resultado = Σspend / Σresultados (não média dos ads)", () => {
    const rows = run({
      ads: [ad("a1", "CR1"), ad("a2", "CR1")],
      observations: [obs("a1", "CR1"), obs("a2", "CR1")],
      dailyInsights: [
        day("a1", "2026-08-10", 300, 1000, 50, 20), // custo/res do ad = 15
        day("a2", "2026-08-11", 700, 2000, 90, 60), // custo/res do ad = 11.67
      ],
    });
    // Σspend 1000 / Σres 80 = 12.5 (nunca média 13.33)
    expect(rows[0].metrics.cost_per_result).toBeCloseTo(12.5, 6);
  });

  it("reach/frequency NÃO são agregados (ausentes do output)", () => {
    const rows = run({
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [day("a1", "2026-08-10", 100, 1000, 50)],
    });
    expect("reach" in rows[0].metrics).toBe(false);
    expect("frequency" in rows[0].metrics).toBe(false);
    expect(rows[0].totals.reach).toBeNull();
    expect(rows[0].totals.frequency).toBeNull();
  });

  it("null (sem evento) ≠ 0: creative sem conversas -> results null", () => {
    const rows = run({
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [day("a1", "2026-08-10", 100, 1000, 50)], // sem started
    });
    expect(rows[0].metrics.results).toBeNull();
    expect(rows[0].metrics.cost_per_result).toBeNull();
    expect(rows[0].metrics.spend).toBe(100);
  });

  it("só dias ATRIBUÍVEIS entram no agregado; incertos ficam no bucket de exclusão", () => {
    // C observado só de 20/08 a 04/09 -> dias 01–19/08 fora
    const rows = run({
      ads: [ad("a1", "CR1")],
      observations: [{ adId: "a1", creativeId: "CR1", firstSeen: "2026-08-20", lastSeen: "2026-09-04" }],
      dailyInsights: [
        day("a1", "2026-08-05", 500, 5000, 100, 40), // fora (pré 1ª observação)
        day("a1", "2026-08-25", 200, 2000, 40, 10), // dentro
      ],
    });
    expect(rows[0].metrics.spend).toBe(200); // só o dia 25
    expect(rows[0].attribution).toBe("partial");
    expect(rows[0].excluded.spend).toBe(500);
    expect(rows[0].excluded.days).toBeGreaterThan(0);
    expect(rows[0].excluded.ads).toBe(1);
    expect(rows[0].excluded.byReason.pre_first_observation).toBeGreaterThan(0);
  });

  it("troca de creative: cada janela vai para o creative certo", () => {
    // a1: CR_A (obs 01–10/08) e CR_B atual (obs 20/08–04/09)
    const rows = run({
      ads: [ad("a1", "CR_B")],
      observations: [
        { adId: "a1", creativeId: "CR_A", firstSeen: "2026-08-01", lastSeen: "2026-08-10" },
        { adId: "a1", creativeId: "CR_B", firstSeen: "2026-08-20", lastSeen: "2026-09-04" },
      ],
      dailyInsights: [
        day("a1", "2026-08-05", 100, 1000, 20, 5), // janela de CR_A
        day("a1", "2026-08-15", 100, 1000, 20, 5), // GAP -> ninguém
        day("a1", "2026-08-25", 100, 1000, 20, 5), // janela de CR_B
      ],
    });
    const byId = new Map(rows.map((r) => [r.creativeId, r]));
    expect(byId.get("CR_A")!.metrics.spend).toBe(100);
    expect(byId.get("CR_B")!.metrics.spend).toBe(100); // só o dia 25, não o gap nem CR_A
    expect(byId.get("CR_B")!.attribution).toBe("partial");
  });

  it("creative sem performance no período: linha existe, hasPeriodPerformance=false", () => {
    const rows = run({
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [], // nenhum insight
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].hasPeriodPerformance).toBe(false);
    expect(rows[0].metrics.spend).toBeNull();
  });

  it("FULLY quando toda a janela cobre o período e nada de hoje/edição", () => {
    const rows = run({
      period: { start: "2026-08-05", end: "2026-08-20" },
      ads: [ad("a1", "CR1")],
      observations: [obs("a1", "CR1")],
      dailyInsights: [day("a1", "2026-08-10", 100, 1000, 50, 5)],
    });
    expect(rows[0].adAttribution[0].status).toBe("FULLY_ATTRIBUTABLE");
    expect(rows[0].attribution).toBe("complete");
    expect(rows[0].excluded.days).toBe(0);
  });
});
