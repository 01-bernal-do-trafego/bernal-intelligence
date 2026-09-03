/**
 * Render real da tabela de criativos (`renderToStaticMarkup`, sem DOM).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreativesTable } from "@/components/client-dashboard/creatives-table";
import type { CreativeValidationRow } from "@/server/meta-creatives-data";

function row(over: Partial<CreativeValidationRow>): CreativeValidationRow {
  return {
    creativeId: "CR1",
    adIds: ["a1", "a2"],
    campaignIds: ["camp1"],
    adsetIds: ["as1"],
    attribution: "complete",
    adAttribution: [
      { adId: "a1", status: "FULLY_ATTRIBUTABLE" },
      { adId: "a2", status: "FULLY_ATTRIBUTABLE" },
    ],
    totals: {
      spend: 1000,
      impressions: 20000,
      clicks: 400,
      inline_link_clicks: null,
      reach: null,
      frequency: null,
      video_3s_views: null,
      video_thruplays: null,
      video_avg_time_watched: null,
      actions: {},
      actionValues: {},
    },
    metrics: {
      spend: 1000,
      impressions: 20000,
      clicks: 400,
      ctr: 2,
      cpc: 2.5,
      cpm: 50,
      results: 620,
      cost_per_result: 1.61,
      messaging_conversations_started: 620,
      cost_per_conversation: 1.61,
      messaging_contacts_total: 661,
      messaging_contacts_new: 499,
    },
    excluded: { spend: 0, days: 0, ads: 0, byReason: {} },
    hasPeriodPerformance: true,
    name: "Criativo Promo",
    objectType: "SHARE",
    format: "image",
    thumbnailUrl: null,
    imageUrl: null,
    imageHash: "hash1",
    videoId: null,
    title: "Minha headline",
    body: "Texto principal do anúncio",
    description: null,
    callToActionType: "SHOP_NOW",
    hasImage: true,
    hasVideo: false,
    isDynamic: false,
    variantSummary: null,
    adNames: ["Ad a1", "Ad a2"],
    campaignNames: ["Campanha X"],
    adsetNames: ["Conjunto Y"],
    ...over,
  };
}

describe("CreativesTable — render", () => {
  it("mostra preview/nome/creative id + copy + CTA + métricas objetivas", () => {
    const html = renderToStaticMarkup(
      <CreativesTable
        rows={[row({})]}
        currency="BRL"
        resultLabel="Conversas iniciadas"
        costLabel="Custo por conversa iniciada"
      />,
    );
    expect(html).toContain("Criativo Promo");
    expect(html).toContain("creative CR1");
    expect(html).toContain("2 anúncios");
    expect(html).toContain("Minha headline");
    expect(html).toContain("SHOP_NOW");
    expect(html).toContain("Imagem"); // badge de formato
    expect(html).toContain("Conversas iniciadas"); // header de results
    expect(html).toContain("Ordenar por:");
  });

  it("badge de atribuição observada quando completa", () => {
    const html = renderToStaticMarkup(
      <CreativesTable rows={[row({ attribution: "complete" })]} currency="BRL" resultLabel="Resultados" costLabel="Custo por resultado" />,
    );
    expect(html).toContain("Atribuição observada");
    expect(html).not.toContain("Histórico não confirmado");
  });

  it("parcial mostra spend/anúncios/dias fora por incerteza", () => {
    const html = renderToStaticMarkup(
      <CreativesTable
        rows={[
          row({
            attribution: "partial",
            excluded: { spend: 500, days: 12, ads: 1, byReason: { pre_first_observation: 12 } },
          }),
        ]}
        currency="BRL"
        resultLabel="Resultados"
        costLabel="Custo por resultado"
      />,
    );
    expect(html).toContain("Atribuição parcial");
    expect(html).toContain("fora");
    expect(html).toContain("12 dia(s)");
  });

  it("não confirmada: badge + aviso, sem misturar no total", () => {
    const html = renderToStaticMarkup(
      <CreativesTable
        rows={[
          row({
            attribution: "unconfirmed",
            metrics: { ...row({}).metrics, spend: null, results: null, cost_per_result: null },
          }),
        ]}
        currency="BRL"
        resultLabel="Resultados"
        costLabel="Custo por resultado"
      />,
    );
    expect(html).toContain("Histórico não confirmado");
    expect(html).toContain("não atribuível com segurança");
  });

  it("null vira '—' e nunca id técnico visível", () => {
    const html = renderToStaticMarkup(
      <CreativesTable
        rows={[row({ metrics: { ...row({}).metrics, results: null, cost_per_result: null } })]}
        currency="BRL"
        resultLabel="Resultados"
        costLabel="Custo por resultado"
      />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("messaging_conversations_started");
    expect(html).not.toContain("cost_per_result<");
  });
});
