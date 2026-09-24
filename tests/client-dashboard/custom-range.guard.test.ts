/**
 * BUG 01 V1.1 — Período personalizado (custom range).
 *
 * Parse-guard: admin (app/(app)/clients/[id]/page.tsx), share
 * (app/share/[token]/page.tsx) e server/real-dashboard.ts puxam módulos
 * "server-only" (não importáveis direto em Vitest). Prova por leitura do
 * texto fonte que:
 *   - admin e share usam o MESMO parser/resolver de período (nenhuma regra
 *     duplicada) e o MESMO contrato de URL (period/dateFrom/dateTo);
 *   - server/real-dashboard.ts reaproveita `resolveDashboardRange` (não
 *     reimplementa a decisão preset-vs-custom inline);
 *   - o range custom NUNCA é usado para pular a filtragem por `client_id`
 *     das consultas a `meta_insights_daily`/`meta_insights_periodic`
 *     (isolamento de cliente preservado — ver também
 *     tests/share/query-isolation.guard.test.ts, que cobre TODAS as
 *     consultas deste arquivo, não só as de período);
 *   - o alcance/frequência do TOTAL de um range custom sem periodic exato
 *     usa uma mensagem PRÓPRIA (não a de "ainda não sincronizado", que seria
 *     enganosa — não há nada a sincronizar para um range livre).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync(
  fileURLToPath(new URL("../../app/(app)/clients/[id]/page.tsx", import.meta.url)),
  "utf8",
);
const sharePage = readFileSync(
  fileURLToPath(new URL("../../app/share/[token]/page.tsx", import.meta.url)),
  "utf8",
);
const realDashboard = readFileSync(
  fileURLToPath(new URL("../../server/real-dashboard.ts", import.meta.url)),
  "utf8",
);
const clientDashboard = readFileSync(
  fileURLToPath(new URL("../../server/client-dashboard.ts", import.meta.url)),
  "utf8",
);

describe("admin + share — mesmo contrato de URL, mesmo resolver (nunca duplicado)", () => {
  for (const [label, src] of [
    ["admin", adminPage],
    ["share", sharePage],
  ] as const) {
    it(`${label}: aceita dateFrom/dateTo em searchParams`, () => {
      expect(src).toMatch(/dateFrom\?:\s*string/);
      expect(src).toMatch(/dateTo\?:\s*string/);
    });

    it(`${label}: resolve via resolvePeriodParam(sp.period, sp.dateFrom, sp.dateTo) de @/lib/meta/period`, () => {
      expect(src).toContain('from "@/lib/meta/period"');
      expect(src).toMatch(/resolvePeriodParam\(sp\.period,\s*sp\.dateFrom,\s*sp\.dateTo\)/);
    });

    it(`${label}: repassa customRange para getClientDashboard (não só preset)`, () => {
      expect(src).toMatch(/getClientDashboard\(\{[\s\S]{0,120}customRange,/);
    });
  }

  it("nenhuma das duas páginas reimplementa parsing de data (nenhum regex/Date manual de dateFrom/dateTo fora de lib/date-range.ts)", () => {
    for (const src of [adminPage, sharePage]) {
      expect(src).not.toMatch(/new Date\(/);
      expect(src).not.toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
    }
  });
});

describe("server/client-dashboard.ts — customRange propagado até a camada real", () => {
  it("ClientDashboardParams aceita customRange (preset widened para MetaPeriodKey)", () => {
    expect(clientDashboard).toMatch(/customRange\?:\s*DateRange \| null;/);
    expect(clientDashboard).toContain("preset?: MetaPeriodKey");
  });

  it("getRealClientDashboard recebe customRange: params.customRange", () => {
    expect(clientDashboard).toMatch(/getRealClientDashboard\(\{[\s\S]{0,200}customRange:\s*params\.customRange,/);
  });
});

describe("server/real-dashboard.ts — reaproveita resolveDashboardRange, não reimplementa a decisão", () => {
  it("importa resolveDashboardRange de @/lib/meta/period (não reimplementa metaPresetRange(preset) inline)", () => {
    expect(realDashboard).toContain('from "@/lib/meta/period"');
    expect(realDashboard).toContain("resolveDashboardRange(preset, today, customRange)");
    // metaPresetRange NÃO é mais chamado diretamente aqui — só dentro de
    // resolveDashboardRange (lib/meta/period.ts), fonte única da decisão.
    expect(realDashboard).not.toMatch(/metaPresetRange\(/);
  });

  it("toda consulta a meta_insights_daily/meta_insights_periodic continua filtrada por client_id — custom não abre exceção", () => {
    const fromCalls = [
      ...realDashboard.matchAll(/\.from\("(meta_campaigns|meta_insights_daily|meta_insights_periodic)"\)/g),
    ];
    expect(fromCalls.length).toBeGreaterThan(0);
    for (const call of fromCalls) {
      const idx = call.index ?? 0;
      const block = realDashboard.slice(idx, idx + 400);
      expect(block).toMatch(/\.eq\("client_id",\s*client\.id\)/);
    }
  });

  it("periodicMissing em custom usa REACH_CUSTOM_RANGE_NOTE, não REACH_NOT_SYNCED_NOTE (mensagem não confunde 'sem periodic exato' com 'sync pendente')", () => {
    expect(realDashboard).toContain("REACH_CUSTOM_RANGE_NOTE");
    expect(realDashboard).toMatch(
      /preset === "custom" \? REACH_CUSTOM_RANGE_NOTE : REACH_NOT_SYNCED_NOTE/,
    );
  });

  it("coverageByPreset (badge dos 7 presets fixos) é omitido em custom — não reporta cobertura errada de presets fora do range pedido", () => {
    expect(realDashboard).toMatch(/preset === "custom"\s*\n\s*\?\s*undefined/);
  });

  it("resolução de account/campaign não depende do preset (filtros combinam livremente com custom)", () => {
    // accountId/campaignId são validados contra linkedIds/campaignById — sem
    // nenhuma referência a `preset`/`customRange` nessas linhas.
    expect(realDashboard).toMatch(/linkedIds\.has\(args\.accountId\)/);
    expect(realDashboard).toMatch(/campaignById\.has\(args\.campaignId\)/);
    const accountLine = realDashboard.match(/const accountId =[\s\S]{0,80}/)?.[0] ?? "";
    const campaignLine = realDashboard.match(/const campaignId =[\s\S]{0,80}/)?.[0] ?? "";
    expect(accountLine).not.toMatch(/preset|customRange/);
    expect(campaignLine).not.toMatch(/preset|customRange/);
  });
});
