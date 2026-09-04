/**
 * Parse-guard das queries de insights em server/agency-overview.ts — garante
 * que TOTAL DO PERÍODO (periodic) e GRÁFICO (daily) filtram exatamente
 * level="account", não misturam attribution_window, e a periodic usa
 * period_key do preset selecionado (não soma vários períodos).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../server/agency-overview.ts", import.meta.url)),
  "utf8",
);

// bloco de queries de insights (periodic + daily), isolado do resto do arquivo.
const insightsBlock = src.slice(
  src.indexOf('supabase\n              .from("meta_insights_periodic")'),
  src.indexOf("const toAccountPeriod"),
);

describe("meta_insights_periodic — TOTAL DO PERÍODO", () => {
  it("filtra level = account", () => {
    expect(insightsBlock).toMatch(/from\("meta_insights_periodic"\)[\s\S]*?\.eq\("level",\s*"account"\)/);
  });
  it("usa period_key do preset selecionado (não busca todos os períodos)", () => {
    expect(insightsBlock).toMatch(
      /from\("meta_insights_periodic"\)[\s\S]*?\.eq\("period_key",\s*preset\)/,
    );
  });
  it("restringe a contas elegíveis via entity_id IN accountIds", () => {
    expect(insightsBlock).toMatch(
      /from\("meta_insights_periodic"\)[\s\S]*?\.in\("entity_id",\s*accountIds\)/,
    );
  });
  it("filtra attribution_window pela lista canônica (ATTR_VALUES), não um valor solto", () => {
    expect(insightsBlock).toMatch(
      /from\("meta_insights_periodic"\)[\s\S]*?\.in\("attribution_window",\s*ATTR_VALUES\)/,
    );
  });
  it("só 1 linha autoritativa por conta — pega a mais recente e ignora repetidas", () => {
    expect(insightsBlock).toMatch(/order\("date_to",\s*\{\s*ascending:\s*false\s*\}\)/);
    expect(src).toMatch(/periodicByAccount\.has\(entityId\)\)\s*continue/);
  });
});

describe("meta_insights_daily — GRÁFICO temporal", () => {
  it("filtra level = account (mesmo nível da periodic — sem misturar campaign/adset/ad)", () => {
    expect(insightsBlock).toMatch(/from\("meta_insights_daily"\)[\s\S]*?\.eq\("level",\s*"account"\)/);
  });
  it("restringe pelas datas do período selecionado", () => {
    expect(insightsBlock).toMatch(/from\("meta_insights_daily"\)[\s\S]*?\.gte\("date",\s*range\.start\)/);
    expect(insightsBlock).toMatch(/from\("meta_insights_daily"\)[\s\S]*?\.lte\("date",\s*range\.end\)/);
  });
  it("mesma lista de contas e mesma atribuição canônica da periodic", () => {
    expect(insightsBlock).toMatch(
      /from\("meta_insights_daily"\)[\s\S]*?\.in\("entity_id",\s*accountIds\)/,
    );
    expect(insightsBlock).toMatch(
      /from\("meta_insights_daily"\)[\s\S]*?\.in\("attribution_window",\s*ATTR_VALUES\)/,
    );
  });
});

describe("nenhuma query de insights usa level diferente de 'account'", () => {
  it('não há .eq("level", "campaign"|"adset"|"ad") neste arquivo', () => {
    expect(src).not.toMatch(/\.eq\("level",\s*"(campaign|adset|ad)"\)/);
  });
});
