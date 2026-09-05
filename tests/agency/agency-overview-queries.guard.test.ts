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
  it("traz date_from/date_to/attribution_window p/ a seleção autoritativa", () => {
    expect(insightsBlock).toMatch(
      /from\("meta_insights_periodic"\)\s*\.select\(\s*"[^"]*date_from[^"]*date_to[^"]*attribution_window/,
    );
  });
  it("NÃO decide pela 'linha mais recente' (sem .order date_to)", () => {
    // o bug antigo: period_key + maior date_to. Agora a regra é intervalo EXATO.
    expect(insightsBlock).not.toMatch(/from\("meta_insights_periodic"\)[\s\S]*?\.order\(/);
  });
  it("seleção autoritativa delegada à função pura compartilhada (intervalo exato)", () => {
    expect(src).toMatch(
      /selectAuthoritativePeriodicByEntity\(\s*\(periodicData[\s\S]*?\{\s*from:\s*range\.start,\s*to:\s*range\.end\s*\}/,
    );
    expect(src).toContain(
      'import { selectAuthoritativePeriodicByEntity } from "@/lib/meta/periodic-select"',
    );
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

describe("daily fallback também é de-dup por attribution_window", () => {
  it("agency-overview.ts de-dup o diário por (conta, dia) antes de somar", () => {
    expect(src).toMatch(/dedupeByAttribution\(\s*\(dailyData[\s\S]*?entity_id.*?\|.*?date/);
    expect(src).toContain('from "@/lib/meta/insights-attribution"');
  });
  it("seleciona attribution_window da lista, sem somar as duas janelas", () => {
    expect(src).not.toMatch(/for \(const row of \(dailyData/); // não itera o cru direto
  });
});

describe("checkbox 'Comparar com período anterior' — não fica morto na V1", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../app/(app)/page.tsx", import.meta.url)),
    "utf8",
  );
  const picker = readFileSync(
    fileURLToPath(new URL("../../components/ui/date-range-picker.tsx", import.meta.url)),
    "utf8",
  );
  it("a Agency Overview passa showCompare={false}", () => {
    expect(page).toMatch(/showCompare=\{false\}/);
  });
  it("DateRangePicker esconde o checkbox quando showCompare é false", () => {
    expect(picker).toMatch(/\{showCompare &&/);
  });
  it("a página NÃO lê 'compare' do searchParams (nada compararia)", () => {
    expect(page).not.toMatch(/compare/);
  });
});

describe("dashboard individual usa a MESMA seleção canônica compartilhada", () => {
  const realDash = readFileSync(
    fileURLToPath(new URL("../../server/real-dashboard.ts", import.meta.url)),
    "utf8",
  );
  it("real-dashboard.ts importa de @/lib/meta/periodic-select", () => {
    expect(realDash).toMatch(/from "@\/lib\/meta\/periodic-select"/);
    expect(realDash).toMatch(/selectAuthoritativePeriodicRow/);
    expect(realDash).toMatch(/selectAuthoritativePeriodicByEntity/);
  });
  it("real-dashboard.ts não decide mais pela 'linha mais recente' (sem .order date_to na periodic)", () => {
    expect(realDash).not.toMatch(/meta_insights_periodic"\)[\s\S]{0,400}?\.order\("date_to"/);
  });
  it("passa o range EXATO (from: range.start, to: range.end) para a seleção", () => {
    expect(realDash).toMatch(/\{\s*from:\s*range\.start,\s*to:\s*range\.end\s*\}/);
  });
});
