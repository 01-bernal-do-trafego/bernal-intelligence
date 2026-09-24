/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Parse-guard de app/share/[token]/page.tsx — puxa server/clients.ts,
 * server/client-dashboard.ts etc. ("server-only", não importável direto em
 * Vitest). Prova as invariantes de segurança/roteamento por leitura do
 * texto fonte, sem executar nada.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../app/share/[token]/page.tsx", import.meta.url)),
  "utf8",
);
const code = src.slice(src.indexOf("*/") + 2);

describe("rota pública — fora de app/(app), sem sessão administrativa", () => {
  it("force-dynamic (nunca cacheia/renderiza estaticamente token/dados)", () => {
    expect(src).toContain('export const dynamic = "force-dynamic";');
  });

  it("robots noindex/nofollow", () => {
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  it("não importa requireAgencySession/AppShell (não é a página administrativa)", () => {
    expect(code).not.toContain("requireAgencySession");
    expect(code).not.toContain("AppShell");
  });
});

describe("autorização — só o token no path resolve o clientId, nunca um input do usuário", () => {
  it("resolveShareToken é chamado com o `token` do path, e SÓ ele", () => {
    expect(code).toMatch(/resolveShareToken\(token\)/);
  });

  it("token inválido/ausente -> notFound() ANTES de qualquer leitura de dados do cliente", () => {
    const resolveIdx = code.indexOf("resolveShareToken(token)");
    const notFoundIdx = code.indexOf("notFound()", resolveIdx);
    const clientReadIdx = code.indexOf("getClientRecord(", resolveIdx);
    expect(notFoundIdx).toBeGreaterThan(resolveIdx);
    expect(notFoundIdx).toBeLessThan(clientReadIdx);
  });

  it("getClientRecord/getClientDashboard usam SOMENTE resolved.clientId — nunca sp./params. como clientId", () => {
    expect(code).toContain("getClientRecord(resolved.clientId)");
    expect(code).toMatch(/getClientDashboard\(\{\s*\n?\s*client,/);
    // nenhuma chamada de leitura de dashboard usa um clientId vindo de searchParams
    expect(code).not.toMatch(/getClientRecord\(sp\./);
    expect(code).not.toMatch(/getClientDashboard\(\{\s*clientId:\s*sp\./);
  });

  it("roda dentro de runInShareContext (reaproveita 100% do query layer via supabase/server.ts)", () => {
    const idx = code.indexOf("return runInShareContext(resolved.clientId, async () => {");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("read-only — nenhuma Server Action/mutation importada", () => {
  it('não importa nenhum módulo "-actions" (sync/share/clients actions)', () => {
    expect(src).not.toMatch(/from ["'][^"']*-actions["']/);
  });

  it("DashboardContent é renderizado com readOnly", () => {
    expect(code).toMatch(/<DashboardContent[\s\S]{0,300}readOnly/);
  });
});

describe("reuso — mesmo getClientDashboard da página administrativa, nenhum cálculo de métrica duplicado", () => {
  it("importa getClientDashboard de @/server/client-dashboard (não reimplementa)", () => {
    expect(src).toContain('from "@/server/client-dashboard"');
  });

  it("importa resolvePeriodParam de @/lib/meta/period (mesmo resolver de período/custom range da página admin — não reimplementa parsing de dateFrom/dateTo)", () => {
    expect(src).toContain('from "@/lib/meta/period"');
    expect(code).toMatch(/resolvePeriodParam\(sp\.period,\s*sp\.dateFrom,\s*sp\.dateTo\)/);
  });

  it("aceita dateFrom/dateTo na URL (mesmo contrato de período personalizado da página admin)", () => {
    expect(code).toMatch(/dateFrom\?:\s*string/);
    expect(code).toMatch(/dateTo\?:\s*string/);
  });
});
