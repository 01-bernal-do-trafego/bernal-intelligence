/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * `DashboardContent` é o MESMO componente usado pela página administrativa
 * e pela página pública compartilhável — nenhum dashboard duplicado. Este
 * teste prova a única diferença de verdade entre os dois modos: `readOnly`
 * esconde "Sincronizar Meta" e o detalhamento de saúde de sincronização
 * (controles/diagnóstico administrativos); os FILTROS de visualização
 * (período, conta, campanha) continuam ativos nos dois modos.
 *
 * `next/navigation` mockado: DateRangePicker/DashboardScopeFilters/
 * SyncMetaButton usam useRouter/usePathname/useSearchParams, que exigem o
 * App Router montado — fora de escopo aqui (é só render estático).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_CONFIG } from "@/lib/dashboard-config";
import type { ClientDashboardData } from "@/server/client-dashboard";
import type { ClientSyncHealth } from "@/server/meta-sync-health";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => "/clients/c1",
  useSearchParams: () => new URLSearchParams(),
}));
// SyncMetaButton importa a Server Action real (`"use server"`), que puxa
// `supabase/auth.ts` (`import "server-only"` — só resolvível dentro do
// compilador do Next, não em Vitest puro). Mesmo padrão de
// dashboard-editor.render.test.tsx: mocka só a Server Action, nunca o
// componente sob teste.
vi.mock("@/app/(app)/clients/[id]/meta-sync-actions", () => ({
  syncMeta: vi.fn(async () => ({ ok: true, results: [], dateFrom: null, dateTo: null })),
}));

// Import DEPOIS do vi.mock (que o Vitest içaria de qualquer forma, mas
// mantém a leitura óbvia): DashboardContent puxa SyncMetaButton/
// DateRangePicker/DashboardScopeFilters, que usam os hooks mockados acima.
const { DashboardContent } = await import("@/components/client-dashboard/dashboard-content");

const zeroMetric = {
  comparison: { current: 0, previous: 0, changePct: null, direction: "flat" as const, sentiment: "neutral" as const },
  format: "number" as const,
  available: true,
};

function baseDashboard(overrides: Partial<ClientDashboardData> = {}): ClientDashboardData {
  return {
    mode: "real",
    dataStatus: "real",
    client: { id: "c1", name: "Cliente Teste", internalName: null, logoUrl: null, status: "active", createdAt: "", updatedAt: "" },
    config: { ...DEFAULT_DASHBOARD_CONFIG, layout: { ...DEFAULT_DASHBOARD_CONFIG.layout, charts: [] } },
    resultMetric: DEFAULT_DASHBOARD_CONFIG.resultMetric,
    accounts: [],
    campaigns: [],
    filters: { accountId: "all", campaignId: "all" },
    preset: "last_7d",
    compare: false,
    range: { start: "2026-09-01", end: "2026-09-07" },
    previous: { start: "2026-08-25", end: "2026-08-31" },
    metrics: {
      investment: zeroMetric,
      results: zeroMetric,
      cost_per_result: zeroMetric,
      reach: zeroMetric,
      impressions: zeroMetric,
      clicks: zeroMetric,
      ctr: zeroMetric,
      cpc: zeroMetric,
      cpm: zeroMetric,
      frequency: zeroMetric,
      messaging_conversations_started: zeroMetric,
      cost_per_conversation: zeroMetric,
      messaging_contacts_total: zeroMetric,
      messaging_contacts_new: zeroMetric,
    },
    series: {},
    campaignRows: [],
    ...overrides,
  };
}

const syncHealth: ClientSyncHealth = {
  performanceSyncedAt: new Date().toISOString(),
  performanceStatus: "fresh",
  lastSyncAt: new Date().toISOString(),
  lastSyncStatus: "success",
  creativesStatus: "ok",
};

describe("DashboardContent — readOnly esconde controles administrativos, mantém filtros", () => {
  it("admin (readOnly=false): mostra Sincronizar Meta e a saúde de sincronização", () => {
    const html = renderToStaticMarkup(
      <DashboardContent
        clientId="c1"
        dashboard={baseDashboard()}
        compare={false}
        syncHealth={syncHealth}
        autoSyncEnabled
      />,
    );
    expect(html).toContain("Sincronizar Meta");
    expect(html).toContain("Sincronização automática:");
  });

  it("share (readOnly=true): NÃO mostra Sincronizar Meta nem a saúde de sincronização", () => {
    const html = renderToStaticMarkup(
      <DashboardContent
        clientId="c1"
        dashboard={baseDashboard()}
        compare={false}
        readOnly
      />,
    );
    expect(html).not.toContain("Sincronizar Meta");
    expect(html).not.toContain("Sincronização automática:");
  });

  it("filtros de visualização (período/conta/campanha) continuam presentes em readOnly", () => {
    const html = renderToStaticMarkup(
      <DashboardContent
        clientId="c1"
        dashboard={baseDashboard()}
        compare={false}
        readOnly
      />,
    );
    expect(html).toContain('aria-label="Período"');
    expect(html).toContain('aria-label="Campanha"');
  });

  it("awaiting_sync: banner some o botão de sync em readOnly, mas mantém o texto", () => {
    const html = renderToStaticMarkup(
      <DashboardContent
        clientId="c1"
        dashboard={baseDashboard({ dataStatus: "awaiting_sync" })}
        compare={false}
        readOnly
      />,
    );
    expect(html).toContain("Rode a primeira sincronização");
    expect(html).not.toContain("Sincronizar Meta");
  });

  it("mesma config/mesmo dashboard -> mesmos cards renderizados nos dois modos (nenhum dashboard duplicado)", () => {
    const dashboard = baseDashboard();
    const adminHtml = renderToStaticMarkup(
      <DashboardContent clientId="c1" dashboard={dashboard} compare={false} />,
    );
    const shareHtml = renderToStaticMarkup(
      <DashboardContent clientId="c1" dashboard={dashboard} compare={false} readOnly />,
    );
    expect(adminHtml).toContain("Performance");
    expect(shareHtml).toContain("Performance");
    expect(adminHtml).toContain("Campanhas");
    expect(shareHtml).toContain("Campanhas");
  });
});
