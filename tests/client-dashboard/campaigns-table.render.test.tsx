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
