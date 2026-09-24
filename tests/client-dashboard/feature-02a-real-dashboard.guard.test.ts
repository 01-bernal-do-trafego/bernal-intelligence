/**
 * FEATURE 02A — catálogo único + métricas já suportadas.
 *
 * `server/real-dashboard.ts` puxa módulos "server-only" (não importável
 * direto em Vitest). Prova por leitura do texto fonte que:
 *   - as métricas novas são computadas via o MESMO `computeMetric` do
 *     Registry sobre uma união de totais (`curAllTotals`/`campaignAllTotals`)
 *     — nenhuma matemática de agregação nova foi escrita à mão;
 *   - a lista do que computar vem do Registry (`REGISTRY_CARD_CHART_IDS`/
 *     `REGISTRY_TABLE_IDS`, derivadas de `METRIC_REGISTRY`), não de uma
 *     lista hardcoded de ~25 ids;
 *   - reach/frequência por campanha usam SÓ o periodic exato (nunca somam
 *     o diário), com fallback explícito para `null` (não `0`);
 *   - as novas colunas da consulta a `meta_insights_periodic`/
 *     `meta_insights_daily` (campanhas) continuam filtradas por `client_id`
 *     (isolamento share preservado — mesmas 5 queries de sempre, nenhuma
 *     query nova).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const realDashboard = readFileSync(
  fileURLToPath(new URL("../../server/real-dashboard.ts", import.meta.url)),
  "utf8",
);

describe("FEATURE 02A — real-dashboard.ts reaproveita o Registry, não reimplementa matemática", () => {
  it("importa METRIC_REGISTRY/getMetricDefinition/computeMetric de lib/metrics — não hardcoda CONVERSION_METRIC_META-like para as métricas novas", () => {
    expect(realDashboard).toContain('from "@/lib/metrics/registry"');
    expect(realDashboard).toContain('from "@/lib/metrics/compute"');
    expect(realDashboard).toContain("METRIC_REGISTRY");
    expect(realDashboard).toContain("computeMetric(");
  });

  it("REGISTRY_CARD_CHART_IDS e REGISTRY_TABLE_IDS são DERIVADOS do Registry (dashboardSurfaces), não uma lista literal de ~25 ids", () => {
    expect(realDashboard).toMatch(/REGISTRY_CARD_CHART_IDS[\s\S]{0,20}=\s*METRIC_REGISTRY\.filter/);
    expect(realDashboard).toMatch(/REGISTRY_TABLE_IDS[\s\S]{0,20}=\s*METRIC_REGISTRY\.filter/);
    expect(realDashboard).toContain('dashboardSurfaces.includes("card")');
    expect(realDashboard).toContain('dashboardSurfaces.includes("table")');
  });

  it("métricas novas do card usam curAllTotals (união de curTotals + ações resolvidas) — mesma fonte, sem duplicar buildRealTotals/conversionTotalsFromRow", () => {
    expect(realDashboard).toMatch(/curAllTotals[\s\S]{0,40}=[\s\S]{0,20}withResolvedResults/);
    expect(realDashboard).toContain("actions: curConvTotals.actions");
    expect(realDashboard).toContain("actionValues: curConvTotals.actionValues");
  });

  it("colunas de tabela novas usam campaignAllTotals (mesma união, por campanha)", () => {
    expect(realDashboard).toContain("campaignAllTotals");
    expect(realDashboard).toContain("actions: convT.actions");
  });

  it("reach/frequência por campanha: SÓ do periodic exato (`p`), nunca do fallback diário (`fb`)", () => {
    const idx = realDashboard.indexOf("p ? { reach: num(p.reach), frequency: num(p.frequency) } : null");
    expect(idx).toBeGreaterThan(-1);
    // nenhuma referência a reach/frequency vindo de `fb` (fallback diário) em todo o arquivo
    expect(realDashboard).not.toMatch(/fb\??\.\s*reach/);
    expect(realDashboard).not.toMatch(/fb\??\.\s*frequency/);
  });

  it("row.reach/row.frequency não têm mais fallback `?? 0` (null vira '—' na tabela, não 0 inventado)", () => {
    const rowBlock = realDashboard.slice(
      realDashboard.indexOf("return {", realDashboard.indexOf("campaignRows: DashboardCampaignRow[]")),
      realDashboard.indexOf("};", realDashboard.indexOf("conversions,")) + 2,
    );
    expect(rowBlock).toContain("reach: t.reach,");
    expect(rowBlock).toContain("frequency: t.frequency,");
    expect(rowBlock).not.toContain("reach: t.reach ?? 0");
  });
});

describe("FEATURE 02A — isolamento share preservado (nenhuma query nova, todas com client_id)", () => {
  it("continuam exatamente 5 chamadas .from(meta_campaigns|meta_insights_daily|meta_insights_periodic)", () => {
    const fromCalls = [
      ...realDashboard.matchAll(/\.from\("(meta_campaigns|meta_insights_daily|meta_insights_periodic)"\)/g),
    ];
    expect(fromCalls.length).toBe(5);
  });

  it("toda query continua filtrada por .eq(\"client_id\", client.id) — a extensão de colunas/registry não abriu exceção", () => {
    const fromCalls = [
      ...realDashboard.matchAll(/\.from\("(meta_campaigns|meta_insights_daily|meta_insights_periodic)"\)/g),
    ];
    for (const call of fromCalls) {
      const idx = call.index ?? 0;
      const block = realDashboard.slice(idx, idx + 400);
      expect(block).toMatch(/\.eq\("client_id",\s*client\.id\)/);
    }
  });

  it("REGISTRY_CARD_CHART_IDS/REGISTRY_TABLE_IDS/computeMetric não fazem NENHUMA chamada de rede — são puros, operam sobre totais já buscados", () => {
    // nenhum .from(/.select(/await supabase no bloco onde REGISTRY_CARD_CHART_IDS é consumido
    const idx = realDashboard.indexOf("for (const registryId of REGISTRY_CARD_CHART_IDS)");
    const end = realDashboard.indexOf("\n  }\n", idx);
    const block = realDashboard.slice(idx, end);
    expect(block).not.toContain("supabase");
    expect(block).not.toContain(".from(");
  });
});
