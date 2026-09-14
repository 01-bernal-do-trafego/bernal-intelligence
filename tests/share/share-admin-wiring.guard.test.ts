/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Parse-guard da fiação do lado administrativo:
 *   - components/client-dashboard/dashboard-header-actions.tsx: o modal
 *     "Compartilhar" antigo (placeholder "Recurso previsto para uma fase
 *     futura") foi substituído pelo ShareLinkModal real.
 *   - app/(app)/clients/[id]/page.tsx: busca o estado do link (RLS normal)
 *     e reaproveita DashboardContent (nenhum dashboard duplicado).
 *
 * Ambos puxam módulos "server-only" transitivamente (page.tsx -> server/*;
 * dashboard-header-actions.tsx -> share-actions.ts -> supabase/auth.ts) —
 * não importáveis direto em Vitest. Lê o texto fonte.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const headerActions = readFileSync(
  fileURLToPath(new URL("../../components/client-dashboard/dashboard-header-actions.tsx", import.meta.url)),
  "utf8",
);
const adminPage = readFileSync(
  fileURLToPath(new URL("../../app/(app)/clients/[id]/page.tsx", import.meta.url)),
  "utf8",
);

describe("dashboard-header-actions.tsx — share real, não mais placeholder", () => {
  it('PLACEHOLDER não tem mais a chave "share" (só export/duplicate continuam placeholder)', () => {
    expect(headerActions).toMatch(/type PlaceholderKey = "export" \| "duplicate";/);
    expect(headerActions).not.toMatch(/type PlaceholderKey = "share"/);
  });

  it("importa e renderiza ShareLinkModal com clientId e initialActive={shareLinkActive}", () => {
    expect(headerActions).toContain('from "./share-link-modal"');
    expect(headerActions).toMatch(
      /<ShareLinkModal clientId=\{clientId\} initialActive=\{shareLinkActive\} \/>/,
    );
  });

  it("shareLinkActive é uma prop obrigatória do componente", () => {
    expect(headerActions).toMatch(/shareLinkActive:\s*boolean;/);
  });

  it('o texto legado "Recurso previsto para uma fase futura" continua existindo SÓ para export/duplicate, nunca mais associado a "share"', () => {
    expect(headerActions).toContain("Recurso previsto para uma fase futura.");
    // A modal genérica de placeholder só é aberta por setPlaceholder("export"/"duplicate") agora.
    expect(headerActions).not.toMatch(/setPlaceholder\("share"\)/);
  });
});

describe("app/(app)/clients/[id]/page.tsx — busca o estado do link e reaproveita DashboardContent", () => {
  it("importa getShareLinkState de @/server/share-link", () => {
    expect(adminPage).toContain('from "@/server/share-link"');
    expect(adminPage).toContain("getShareLinkState(client.id)");
  });

  it("passa shareLinkActive={shareLink.active} para DashboardHeaderActions", () => {
    expect(adminPage).toMatch(/shareLinkActive=\{shareLink\.active\}/);
  });

  it("usa <DashboardContent .../> — nenhum JSX de cards/gráficos/campanhas duplicado nesta página", () => {
    expect(adminPage).toContain("<DashboardContent");
    expect(adminPage).not.toContain("<MetricCard");
    expect(adminPage).not.toContain("<ChartContainer");
    expect(adminPage).not.toContain("<CampaignsTable");
    expect(adminPage).not.toContain("<SyncMetaButton");
  });

  it("passa syncHealth/autoSyncEnabled para DashboardContent (admin continua vendo saúde de sync)", () => {
    expect(adminPage).toMatch(/<DashboardContent[\s\S]{0,200}syncHealth=\{syncHealth\}/);
    expect(adminPage).toMatch(/<DashboardContent[\s\S]{0,200}autoSyncEnabled=\{autoSyncEnabled\}/);
  });

  it("NÃO passa readOnly (a página administrativa não é somente-leitura)", () => {
    const idx = adminPage.indexOf("<DashboardContent");
    const end = adminPage.indexOf("/>", idx);
    const block = adminPage.slice(idx, end);
    expect(block).not.toContain("readOnly");
  });
});
