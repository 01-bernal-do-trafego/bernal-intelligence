import { describe, expect, it } from "vitest";
import {
  insightRowToTotals,
  normalizeInsightRow,
} from "@/lib/meta/normalizer";
import type { MetaInsightRaw } from "@/lib/meta/types";

const rawAd: MetaInsightRaw = {
  date_start: "2026-08-01",
  date_stop: "2026-08-01",
  account_id: "1234567890",
  campaign_id: "23851234567890001",
  adset_id: "23851234567890002",
  ad_id: "23851234567890003",
  spend: "1000.50",
  impressions: "100000",
  reach: "80000",
  clicks: "2000",
  inline_link_clicks: "1500",
  frequency: "1.25",
  actions: [
    { action_type: "lead", value: "50", "7d_click_1d_view": "48" },
    { action_type: "offsite_conversion.fct.lead", value: "5" },
    { action_type: "purchase", value: "10", "7d_click_1d_view": "9" },
    { action_type: "link_click", value: "1500" },
    { action_type: "some_new_event_2027", value: "3" },
    { action_type: "video_view", value: "0" },
  ],
  action_values: [
    { action_type: "purchase", value: "3200.00", "7d_click_1d_view": "2900.00" },
  ],
  video_3_sec_watched_actions: [{ action_type: "video_view", value: "12000" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "3000" }],
};

describe("normalizeInsightRow", () => {
  it("normaliza colunas nativas (string -> número)", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
    })!;
    expect(row.spend).toBe(1000.5);
    expect(row.impressions).toBe(100000);
    expect(row.reach).toBe(80000);
    expect(row.clicks).toBe(2000);
    expect(row.inlineLinkClicks).toBe(1500);
    expect(row.frequency).toBe(1.25);
    expect(row.video3sViews).toBe(12000);
    expect(row.videoThruplays).toBe(3000);
  });

  it("resolve conversões Bernal por PRIORIDADE — sem somar aliases sobrepostos", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
      attributionWindow: "7d_click_1d_view",
    })!;
    // prioridade leads = [lead, offsite_conversion.fct.lead, ...] -> lead = 48
    // (somar lead 48 + offsite 5 = 53 seria dupla contagem do MESMO evento)
    expect(row.actions.leads).toBe(48);
    expect(row.actions.purchases).toBe(9); // janela 7d_click_1d_view
    expect(row.actions.link_clicks).toBe(1500);
    expect(row.actionValues.revenue).toBe(2900);
  });

  it("preserva TODOS os action_types crus em rawActions/rawActionValues", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
      attributionWindow: "7d_click_1d_view",
    })!;
    expect(row.rawActions).toEqual({
      lead: 48,
      "offsite_conversion.fct.lead": 5,
      purchase: 9,
      link_click: 1500,
      some_new_event_2027: 3,
      video_view: 0,
    });
    expect(row.rawActionValues).toEqual({ purchase: 2900 });
  });

  it("NÃO faz dupla contagem quando vários aliases de compra chegam juntos", () => {
    const raw: MetaInsightRaw = {
      date_start: "2026-08-03",
      account_id: "1234567890",
      spend: "500",
      actions: [
        { action_type: "omni_purchase", value: "8" },
        { action_type: "purchase", value: "5" },
        { action_type: "offsite_conversion.fct.purchase", value: "5" },
      ],
      action_values: [
        { action_type: "omni_purchase", value: "800" },
        { action_type: "purchase", value: "500" },
      ],
    };
    const row = normalizeInsightRow(raw, {
      level: "account",
      adAccountId: "act_1234567890",
    })!;
    expect(row.actions.purchases).toBe(8); // omni_purchase (prioridade), não 18
    expect(row.actionValues.revenue).toBe(800); // omni_purchase, não 1300
    // nada se perde: os três aliases ficam no cru
    expect(row.rawActions).toEqual({
      omni_purchase: 8,
      purchase: 5,
      "offsite_conversion.fct.purchase": 5,
    });
  });

  it("action_type desconhecido (não-zero) vai para unmappedActions", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
    })!;
    expect(row.unmappedActions).toContainEqual({
      actionType: "some_new_event_2027",
      value: 3,
    });
    expect(row.actions.some_new_event_2027).toBeUndefined();
  });

  it("valor 0 não vira métrica nem entra no unmapped, mas fica no cru", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
    })!;
    expect(row.actions.video_view).toBeUndefined();
    expect(
      row.unmappedActions.some((u) => u.actionType === "video_view"),
    ).toBe(false);
    expect(row.rawActions.video_view).toBe(0);
  });

  it("NÃO persiste `results` — é config-driven, resolvido em leitura", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
      attributionWindow: "7d_click_1d_view",
    })!;
    // só métricas canônicas
    expect("results" in row.actions).toBe(false);
    expect(row.actions.leads).toBe(48);
    expect(row.actions.purchases).toBe(9);
  });

  it("colunas ausentes viram null; nunca NaN/Infinity", () => {
    const sparse: MetaInsightRaw = {
      date_start: "2026-08-02",
      account_id: "1234567890",
      spend: "10",
      impressions: "500",
    };
    const row = normalizeInsightRow(sparse, {
      level: "account",
      adAccountId: "act_1234567890",
    })!;
    expect(row.clicks).toBeNull();
    expect(row.reach).toBeNull();
    expect(row.frequency).toBeNull();
    expect(row.video3sViews).toBeNull();
    expect(row.actions).toEqual({});
    expect(row.rawActions).toEqual({});
  });

  it("entityId conforme o nível", () => {
    expect(
      normalizeInsightRow(rawAd, { level: "account", adAccountId: "act_1234567890" })!
        .entityId,
    ).toBe("act_1234567890");
    expect(
      normalizeInsightRow(rawAd, { level: "campaign", adAccountId: "act_1234567890" })!
        .entityId,
    ).toBe("23851234567890001");
    expect(
      normalizeInsightRow(rawAd, { level: "ad", adAccountId: "act_1234567890" })!
        .entityId,
    ).toBe("23851234567890003");
  });

  it("sem date_start válido -> null", () => {
    expect(
      normalizeInsightRow({ account_id: "1" }, {
        level: "account",
        adAccountId: "act_1",
      }),
    ).toBeNull();
  });

  it("janela de atribuição é registrada", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
    })!;
    expect(row.attributionWindow).toBe("unified_attribution"); // default (config unificada)
  });
});

describe("insightRowToTotals", () => {
  it("converte para o shape que o registry consome (só canônicas)", () => {
    const row = normalizeInsightRow(rawAd, {
      level: "ad",
      adAccountId: "act_1234567890",
    })!;
    const totals = insightRowToTotals(row);
    expect(totals.spend).toBe(1000.5);
    expect(totals.actions.leads).toBe(row.actions.leads);
    expect(totals.actions.purchases).toBe(row.actions.purchases);
    expect("results" in totals.actions).toBe(false);
    expect(totals.actionValues.revenue).toBe(row.actionValues.revenue);
  });
});
