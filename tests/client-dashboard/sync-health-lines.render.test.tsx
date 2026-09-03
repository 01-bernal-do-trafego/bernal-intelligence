import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncHealthLines } from "@/components/client-dashboard/sync-health-lines";
import type { ClientSyncHealth } from "@/server/meta-sync-health";

const health: ClientSyncHealth = {
  performanceSyncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  performanceStatus: "fresh",
  lastSyncAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastSyncStatus: "partial",
  creativesStatus: "partial",
};

describe("SyncHealthLines — estado do Auto Sync", () => {
  it("cron NÃO ativado -> 'inativa', nunca 'ativa (a cada'", () => {
    const html = renderToStaticMarkup(
      <SyncHealthLines health={health} autoSyncEnabled={false} />,
    );
    expect(html).toContain("Sincronização automática:");
    expect(html).toContain("inativa");
    expect(html).not.toContain("ativa (a cada");
  });

  it("default (sem prop) -> inativa", () => {
    const html = renderToStaticMarkup(<SyncHealthLines health={null} />);
    expect(html).toContain("inativa");
  });

  it("cron ativado -> 'ativa (a cada ~4h)'", () => {
    const html = renderToStaticMarkup(
      <SyncHealthLines health={health} autoSyncEnabled />,
    );
    expect(html).toContain("ativa (a cada ~4h)");
  });

  it("mostra os 3 eixos separados; falha não some com performance", () => {
    const html = renderToStaticMarkup(
      <SyncHealthLines
        health={{ ...health, lastSyncStatus: "failed", performanceStatus: "fresh" }}
        autoSyncEnabled={false}
      />,
    );
    expect(html).toContain("Dados de performance:");
    expect(html).toContain("Atualizados"); // performance segue fresh
    expect(html).toContain("Criativos:");
    expect(html).toContain("Última sincronização:");
    expect(html).toContain("Falhou"); // last sync reflete a falha
  });
});
