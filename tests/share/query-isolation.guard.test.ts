/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link — SECURITY HARDENING FINAL.
 *
 * `service_role` faz bypass de RLS — o AsyncLocalStorage do ShareContext só
 * guarda QUEM está autorizado (o clientId resolvido do token); ele NÃO limita
 * automaticamente nenhuma query. A garantia real tem que estar em CADA query
 * do grafo alcançável por `getClientDashboard(...)` no caminho público.
 *
 * Este arquivo é o mapeamento + prova estrutural do grafo COMPLETO (7
 * arquivos, 12 queries `.from(...)` — nenhuma outra existe: `grep -rn
 * "\.from(\"" server/real-dashboard.ts server/client-data-mode.ts
 * server/meta-connection.ts server/meta-ad-accounts.ts
 * server/dashboard-config.ts server/clients.ts server/client-dashboard.ts`
 * dá exatamente 12 ocorrências, todas cobertas abaixo).
 *
 * Achado da auditoria: TODAS as 12 já eram explicitamente escopadas por
 * client_id/id ANTES desta rodada (defesa em profundidade pré-existente,
 * independente de RLS — o mesmo padrão já usado para acesso multi-tenant da
 * equipe Bernal). Por isso NENHUM arquivo de produção foi alterado aqui —
 * só estes testes, provando o que já era verdade.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");

// Nenhum destes arquivos tem doc-comment de cabeçalho ANTES dos imports (todos
// começam com `import "server-only";`) — usar o texto bruto é seguro aqui:
// os padrões procurados (`.eq("client_id", ...)`) não aparecem em prosa.
const realDashboard = read("server/real-dashboard.ts");
const clientDataMode = read("server/client-data-mode.ts");
const metaConnection = read("server/meta-connection.ts");
const metaAdAccounts = read("server/meta-ad-accounts.ts");
const dashboardConfig = read("server/dashboard-config.ts");
const clientsSrc = read("server/clients.ts");
const clientDashboard = read("server/client-dashboard.ts");
const sharePage = read("app/share/[token]/page.tsx");

describe("grafo de queries alcançável pelo share público — 12 queries, todas com client_id/id explícito", () => {
  it("server/clients.ts#getClientRecord — .eq(\"id\", id) (única função de server/clients.ts usada pelo share)", () => {
    const idx = clientsSrc.indexOf("export const getClientRecord");
    const block = clientsSrc.slice(idx, idx + 400);
    expect(block).toContain('.eq("id", id)');
  });

  it("server/client-data-mode.ts#getClientDataMode — meta_sync_runs .eq(\"client_id\", clientId)", () => {
    expect(clientDataMode).toContain('.from("meta_sync_runs")');
    const idx = clientDataMode.indexOf('.from("meta_sync_runs")');
    const block = clientDataMode.slice(idx, idx + 200);
    expect(block).toContain('.eq("client_id", clientId)');
  });

  it("server/meta-connection.ts#getMetaConnection — meta_connections .eq(\"client_id\", clientId)", () => {
    const idx = metaConnection.indexOf('.from("meta_connections")');
    const block = metaConnection.slice(idx, idx + 200);
    expect(block).toContain('.eq("client_id", clientId)');
  });

  it("server/meta-ad-accounts.ts#listMetaAdAccounts — meta_ad_accounts .eq(\"client_id\", clientId)", () => {
    const idx = metaAdAccounts.indexOf('.from("meta_ad_accounts")');
    const block = metaAdAccounts.slice(idx, idx + 250);
    expect(block).toContain('.eq("client_id", clientId)');
  });

  it("server/dashboard-config.ts#getDashboardConfig — dashboard_configs .eq(\"client_id\", clientId)", () => {
    const idx = dashboardConfig.indexOf('.from("dashboard_configs")');
    const block = dashboardConfig.slice(idx, idx + 200);
    expect(block).toContain('.eq("client_id", clientId)');
  });

  it("real-dashboard.ts#1 — meta_campaigns .eq(\"client_id\", client.id)", () => {
    const idx = realDashboard.indexOf('.from("meta_campaigns")');
    const block = realDashboard.slice(idx, idx + 150);
    expect(block).toContain('.eq("client_id", client.id)');
  });

  it("real-dashboard.ts#2 — meta_insights_daily (linhas diárias) .eq(\"client_id\", client.id)", () => {
    const idx = realDashboard.indexOf('.from("meta_insights_daily")');
    const block = realDashboard.slice(idx, idx + 350);
    expect(block).toContain('.eq("client_id", client.id)');
  });

  it("real-dashboard.ts#3 — meta_insights_periodic (reach/frequency do período) .eq(\"client_id\", client.id)", () => {
    const idx = realDashboard.indexOf('.from("meta_insights_periodic")');
    const block = realDashboard.slice(idx, idx + 350);
    expect(block).toContain('.eq("client_id", client.id)');
  });

  it("real-dashboard.ts#4 — meta_insights_periodic (tabela de campanhas) .eq(\"client_id\", client.id)", () => {
    const idx = realDashboard.lastIndexOf('.from("meta_insights_periodic")');
    const block = realDashboard.slice(idx, idx + 250);
    expect(block).toContain('.eq("client_id", client.id)');
  });

  it("real-dashboard.ts#5 — meta_insights_daily (tabela de campanhas) .eq(\"client_id\", client.id)", () => {
    const idx = realDashboard.lastIndexOf('.from("meta_insights_daily")');
    const block = realDashboard.slice(idx, idx + 250);
    expect(block).toContain('.eq("client_id", client.id)');
  });

  it("nenhuma das 5 queries de real-dashboard.ts é feita sem NENHUM .eq (select amplo contando com RLS)", () => {
    const fromCalls = [...realDashboard.matchAll(/\.from\("(meta_campaigns|meta_insights_daily|meta_insights_periodic)"\)/g)];
    expect(fromCalls.length).toBe(5);
    for (const m of fromCalls) {
      const after = realDashboard.slice(m.index!, m.index! + 400);
      expect(after).toMatch(/\.eq\("client_id", client\.id\)/);
    }
  });
});

describe("accountId/campaignId vindos de searchParams — validados contra o PRÓPRIO client antes de virar filtro", () => {
  it("accountId só é aceito se pertence a `linked` (dataMode.linkedAccounts, já resolvido por client_id)", () => {
    const idx = realDashboard.indexOf("const linkedIds = new Set(linked.map((a) => a.adAccountId));");
    expect(idx).toBeGreaterThan(-1);
    const block = realDashboard.slice(idx, idx + 200);
    expect(block).toMatch(/args\.accountId && linkedIds\.has\(args\.accountId\) \? args\.accountId : "all"/);
  });

  it("campaignId só é aceito se existe em `campaigns` (já filtrado por client_id acima)", () => {
    const idx = realDashboard.indexOf("const campaignById = new Map(campaigns.map((c) => [c.id, c]));");
    expect(idx).toBeGreaterThan(-1);
    const block = realDashboard.slice(idx, idx + 200);
    expect(block).toMatch(/args\.campaignId && campaignById\.has\(args\.campaignId\) \? args\.campaignId : "all"/);
  });

  it("a validação acontece ANTES de qualquer uso de accountId/campaignId nas queries de meta_insights_*", () => {
    const accountValidationIdx = realDashboard.indexOf("linkedIds.has(args.accountId)");
    const campaignValidationIdx = realDashboard.indexOf("campaignById.has(args.campaignId)");
    const firstInsightsQueryIdx = realDashboard.indexOf('.from("meta_insights_daily")');
    expect(accountValidationIdx).toBeGreaterThan(-1);
    expect(campaignValidationIdx).toBeGreaterThan(-1);
    expect(accountValidationIdx).toBeLessThan(firstInsightsQueryIdx);
    expect(campaignValidationIdx).toBeLessThan(firstInsightsQueryIdx);
  });

  it("mesmo SEM essa validação, client_id continua sendo o filtro primário — um account/campaign de OUTRO client nunca aparece (defesa em profundidade, não single point of failure)", () => {
    // Nenhuma query usa accountId/campaignId SOZINHO sem client_id junto no mesmo .from(...).
    const fromCalls = [...realDashboard.matchAll(/\.from\("meta_insights_(daily|periodic)"\)/g)];
    for (const m of fromCalls) {
      const block = realDashboard.slice(m.index!, m.index! + 400);
      expect(block).toContain('.eq("client_id", client.id)');
    }
  });
});

describe("universo fechado — só funções client_id-scoped são alcançáveis pelo caminho público", () => {
  it("client-dashboard.ts (orquestrador) não faz nenhuma query própria (mode real delega 100% pra real-dashboard.ts)", () => {
    expect(clientDashboard).not.toMatch(/createSupabaseServerClient/);
  });

  it("app/share/[token]/page.tsx só importa getClientRecord/getClientDashboard de server/* — nunca listClients/countActiveClients/qualquer função sem client_id", () => {
    expect(sharePage).not.toContain("listClients");
    expect(sharePage).not.toContain("countActiveClients");
    const serverImports = [...sharePage.matchAll(/from "@\/server\/([^"]+)"/g)].map((m) => m[1]);
    expect(serverImports.sort()).toEqual(["client-dashboard", "clients", "share-link"]);
  });

  it("server/clients.ts#listClients e #countActiveClients (sem client_id — listam TUDO) nunca são importados por app/share/** ou components/client-dashboard/dashboard-content.tsx", () => {
    const dashboardContent = read("components/client-dashboard/dashboard-content.tsx");
    for (const forbidden of ["listClients", "countActiveClients"]) {
      expect(sharePage).not.toContain(forbidden);
      expect(dashboardContent).not.toContain(forbidden);
    }
  });
});
