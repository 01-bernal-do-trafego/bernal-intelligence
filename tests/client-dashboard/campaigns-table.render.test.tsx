/**
 * Render real da tabela de campanhas com colunas de conversão liberadas.
 * `renderToStaticMarkup` (sem DOM) — DataTable e CampaignsTable não usam portal.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignsTable } from "@/components/client-dashboard/campaigns-table";
import type { DashboardCampaignRow } from "@/server/client-dashboard";
import type { ResultMetricConfig } from "@/types/domain";

const resultMetric: ResultMetricConfig = {
  type: "messaging_conversations_started",
  resultLabel: "Conversas iniciadas",
  costLabel: "Custo por conversa iniciada",
  behavior: "higher_is_better",
};

function row(over: Partial<DashboardCampaignRow>): DashboardCampaignRow {
  return {
    id: "c1",
    name: "Campanha A",
    status: "active",
    spend: 1000,
    reach: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    frequency: 0,
    conversions: {
      results: 620,
      cost_per_result: 1.6,
      messaging_conversations_started: 620,
      cost_per_conversation: 1.6,
      messaging_contacts_total: 661,
      messaging_contacts_new: 499,
    },
    ...over,
  };
}

const COLUMNS = [
  "campaign",
  "investment",
  "results",
  "cost_per_result",
  "messaging_conversations_started",
  "cost_per_conversation",
  "messaging_contacts_total",
  "messaging_contacts_new",
];

describe("CampaignsTable — colunas de conversão", () => {
  it("renderiza os cabeçalhos amigáveis das colunas liberadas", () => {
    const html = renderToStaticMarkup(
      <CampaignsTable
        rows={[row({})]}
        resultMetric={resultMetric}
        columns={COLUMNS}
      />,
    );
    expect(html).toContain("Conversas iniciadas"); // results usa o resultLabel
    expect(html).toContain("Custo por conversa iniciada");
    expect(html).toContain("Total de contatos");
    expect(html).toContain("Novos contatos");
    // nada de id técnico como cabeçalho:
    expect(html).not.toContain("messaging_contacts_total");
    expect(html).not.toContain("cost_per_conversation");
  });

  it("cada campanha usa seus próprios valores; 661 e 499 aparecem", () => {
    const html = renderToStaticMarkup(
      <CampaignsTable
        rows={[row({})]}
        resultMetric={resultMetric}
        columns={COLUMNS}
      />,
    );
    expect(html).toContain("661");
    expect(html).toContain("499");
  });

  it("evento ausente (null) -> '—'; zero medido -> '0' (não inventa dado)", () => {
    const html = renderToStaticMarkup(
      <CampaignsTable
        rows={[
          row({
            id: "c2",
            name: "Sem contatos",
            conversions: {
              results: 0,
              cost_per_result: 0,
              messaging_conversations_started: 0,
              cost_per_conversation: 0,
              messaging_contacts_total: null,
              messaging_contacts_new: null,
            },
          }),
        ]}
        resultMetric={resultMetric}
        columns={COLUMNS}
      />,
    );
    expect(html).toContain("—"); // colunas total/novos contatos: null
    expect(html).toContain(">0<"); // conversas iniciadas medidas com zero
  });
});

/* ================= FEATURE 02A — colunas novas ================= */

const FEATURE_02A_COLUMNS = [
  "campaign",
  "investment",
  "reach",
  "frequency",
  "inline_link_clicks",
  "ctr_link",
  "cpc_link",
  "leads",
  "cpl",
  "landing_page_views",
  "cost_per_landing_page_view",
  "purchases",
  "cpa",
  "revenue",
  "roas",
  "add_to_cart",
  "cost_per_add_to_cart",
  "initiate_checkout",
  "cost_per_initiate_checkout",
  "post_engagement",
  "post_reactions",
  "post_comments",
  "post_saves",
];

describe("FEATURE 02A — colunas novas renderizam com cabeçalho e formato corretos", () => {
  const fullRow = row({
    conversions: {
      inline_link_clicks: 3800,
      ctr_link: 3.4682,
      cpc_link: 0.406,
      leads: 12,
      cpl: 128.59,
      landing_page_views: 1270,
      cost_per_landing_page_view: 1.2151,
      purchases: 8,
      cpa: 192.885,
      revenue: 2500,
      roas: 1.62,
      add_to_cart: 67,
      cost_per_add_to_cart: 23.03,
      initiate_checkout: 25,
      cost_per_initiate_checkout: 61.72,
      post_engagement: 3229,
      post_reactions: 827,
      post_comments: 343,
      post_saves: 465,
    },
  });

  it("cabeçalhos vêm do catálogo — nenhum id técnico vaza como texto visível", () => {
    const html = renderToStaticMarkup(
      <CampaignsTable rows={[fullRow]} resultMetric={resultMetric} columns={FEATURE_02A_COLUMNS} />,
    );
    for (const label of [
      "Alcance",
      "Frequência",
      "Cliques no link",
      "CTR (link)",
      "CPC (link)",
      "Leads",
      "Custo por lead",
      "Visualizações da página",
      "Compras",
      "CPA",
      "Receita",
      "ROAS",
      "Adições ao carrinho",
      "Finalizações iniciadas",
      "Engajamentos",
      "Reações",
      "Comentários",
      "Salvamentos",
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).not.toContain("cost_per_landing_page_view");
    expect(html).not.toContain("post_engagement");
  });

  it("CTR (link) formata como percentual; ROAS/CPL/CPA como decimal/moeda — não número cru", () => {
    const html = renderToStaticMarkup(
      <CampaignsTable rows={[fullRow]} resultMetric={resultMetric} columns={FEATURE_02A_COLUMNS} />,
    );
    expect(html).toContain("3,47%"); // ctr_link formatado como percent (pt-BR)
    expect(html).toContain("1,62"); // roas decimal
  });

  it("reach/frequency NULL (sem periodic exato) -> '—', nunca '0' inventado", () => {
    const noPeriodic = row({ reach: null, frequency: null, conversions: {} });
    const html = renderToStaticMarkup(
      <CampaignsTable rows={[noPeriodic]} resultMetric={resultMetric} columns={["campaign", "reach", "frequency"]} />,
    );
    const dashCount = (html.match(/—/g) ?? []).length;
    expect(dashCount).toBeGreaterThanOrEqual(2); // reach + frequency
  });

  it("reach/frequency com periodic exato -> valor real, não '—'", () => {
    const withPeriodic = row({ reach: 21000, frequency: 5.22, conversions: {} });
    const html = renderToStaticMarkup(
      <CampaignsTable rows={[withPeriodic]} resultMetric={resultMetric} columns={["campaign", "reach", "frequency"]} />,
    );
    expect(html).toContain("21.000"); // formatNumber pt-BR
    expect(html).toContain("5,22"); // formatDecimal
  });

  it("ecommerce sem evento (cliente sem purchases, ex.: Atacado do Chinelo hoje) -> '—', não bloqueia a coluna", () => {
    const noEcommerce = row({ conversions: { purchases: null, cpa: null, revenue: null, roas: null } });
    const html = renderToStaticMarkup(
      <CampaignsTable rows={[noEcommerce]} resultMetric={resultMetric} columns={["campaign", "purchases", "cpa", "revenue", "roas"]} />,
    );
    const dashCount = (html.match(/—/g) ?? []).length;
    expect(dashCount).toBeGreaterThanOrEqual(4);
  });
});
