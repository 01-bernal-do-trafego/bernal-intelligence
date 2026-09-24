/**
 * BUG 01 V1.1 — ajuste final de data quality / copy.
 *
 * Um dia sem linha em `meta_insights_daily` NÃO é evidência de falha de
 * sincronização (pode ser campanha sem veiculação, conta sem saldo, pausa —
 * visto na prática no Atacado do Chinelo). A copy do produto tem que ser
 * neutra e nunca afirmar/implicar falha de sync sem evidência real.
 *
 * `components/client-dashboard/dashboard-content.tsx` e
 * `server/real-dashboard.ts` puxam módulos "server-only"/JSX Server Component
 * — não importáveis direto em Vitest fora do compilador Next. Prova por
 * leitura do texto fonte que:
 *   - nenhuma frase banida ("período incompleto", "sincronização
 *     incompleta", "dados faltando", "Rode Sincronizar Meta" como acusação)
 *     sobrevive nos 3 pontos que transformam `selectedCoverage` em texto
 *     visível (banner, nota do gráfico, `unavailableReason` do card);
 *   - os 3 pontos usam a MESMA função `coverageNote` (fonte única da copy —
 *     nenhuma reimplementação local de mensagem).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardContent = readFileSync(
  fileURLToPath(
    new URL("../../components/client-dashboard/dashboard-content.tsx", import.meta.url),
  ),
  "utf8",
);
const realDashboard = readFileSync(
  fileURLToPath(new URL("../../server/real-dashboard.ts", import.meta.url)),
  "utf8",
);

const BANNED_REGEXES = [
  /per[ií]odo incompleto/i,
  /gr[aá]fico incompleto/i,
  /sincroniza[cç][aã]o incompleta/i,
  /dados faltando/i,
  /rode\s*[“"]?sincronizar meta[”"]?/i, // como ordem/acusação de falha
  /ainda n[aã]o foi sincronizado/i,
];

describe("dashboard-content.tsx — copy de cobertura é neutra", () => {
  it("nenhuma frase banida no texto fonte (banner + nota do gráfico)", () => {
    for (const re of BANNED_REGEXES) {
      expect(dashboardContent).not.toMatch(re);
    }
  });

  it("banner E nota do gráfico usam coverageNote (fonte única de copy, não reimplementada 2x)", () => {
    expect(dashboardContent).toContain('from "@/lib/meta/daily-coverage"');
    const calls = [...dashboardContent.matchAll(/coverageNote\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("banner não usa mais missingDates.length diretamente na copy (delegado a coverageNote)", () => {
    // a única leitura de missingDates que pode sobrar é dentro de coverageNote
    // (lib/meta/daily-coverage.ts), não neste arquivo.
    expect(dashboardContent).not.toMatch(/selectedCoverage\.missingDates\.length/);
  });
});

describe("server/real-dashboard.ts — unavailableReason de card também usa a copy neutra", () => {
  it("nenhuma frase banida no texto fonte", () => {
    for (const re of BANNED_REGEXES) {
      expect(realDashboard).not.toMatch(re);
    }
  });

  it("INCOMPLETE_NOTE vem de coverageNote(selectedCoverage), não de um template string manual", () => {
    expect(realDashboard).toContain("coverageNote(selectedCoverage)");
  });
});
