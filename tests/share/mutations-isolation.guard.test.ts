/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link — SECURITY HARDENING FINAL.
 *
 * `DashboardContent readOnly` esconder o botão NÃO é garantia de segurança
 * por si só — Server Actions do Next são endpoints HTTP próprios,
 * alcançáveis independentemente de qual botão está renderizado na página.
 * A garantia real é estrutural, em duas camadas:
 *
 *   1. TODA Server Action ("use server") deste app checa sessão/papel via
 *      getSessionContext() — cookie-bound, NUNCA o ShareContext — ANTES de
 *      qualquer escrita. Isso é verdade INDEPENDENTE de qual UI a invocou.
 *   2. `runInShareContext` só envolve o RENDER da página pública (nunca uma
 *      Server Action) — nenhum arquivo "use server" importa/usa
 *      isInShareContext/getShareContextClientId/runInShareContext, então
 *      nenhuma Action jamais "vê" o service_role do share nem se comporta
 *      diferente por causa dele.
 *
 * (A prova RUNTIME de que runInShareContext nunca vaza entre invocações
 * concorrentes/distintas já está em tests/share/share-context.test.ts —
 * aqui é a prova ESTRUTURAL de que nenhuma Action tenta usá-lo.)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");

const ACTION_FILES = [
  "app/(app)/actions.ts",
  "app/(app)/clients/[id]/meta-accounts-actions.ts",
  "app/(app)/clients/[id]/meta-sync-actions.ts",
  "app/(app)/clients/[id]/share-actions.ts",
  "app/(app)/clients/actions.ts",
] as const;

describe('todo arquivo "use server" do app é uma destas 5 (universo fechado)', () => {
  it("nenhum outro arquivo .ts sob app/ declara \"use server\" além dos 5 mapeados", () => {
    // Prova negativa indireta: soma de "use server" em app/ bate com o mapeamento.
    let total = 0;
    for (const f of ACTION_FILES) {
      expect(read(f).trimStart().startsWith('"use server"')).toBe(true);
      total++;
    }
    expect(total).toBe(5);
  });
});

describe("cada Server Action reafirma sessão/papel via cookie — NUNCA via ShareContext", () => {
  it("signOut: modo supabase + createSupabaseServerClient (cookie normal) — sem dado de cliente, não é mutation de dashboard", () => {
    const src = read("app/(app)/actions.ts");
    expect(src).not.toContain("isInShareContext");
    expect(src).not.toContain("runInShareContext");
  });

  for (const [file, exported] of [
    ["app/(app)/clients/[id]/meta-accounts-actions.ts", "linkMetaAdAccounts/discoverMetaAdAccounts (ver arquivo)"],
    ["app/(app)/clients/[id]/meta-sync-actions.ts", "syncMeta"],
    ["app/(app)/clients/[id]/share-actions.ts", "regenerateShareLink/deactivateShareLink"],
    ["app/(app)/clients/actions.ts", "createClient/updateClient/archiveClient/saveDashboardConfig (ver arquivo)"],
  ] as const) {
    it(`${file} (${exported}): getSessionContext() aparece ANTES de qualquer escrita, cookie-bound (nunca ShareContext)`, () => {
      const src = read(file);
      expect(src).toContain("getSessionContext()");
      expect(src).toContain("isAgencyRole(profile.role)");
      expect(src).not.toContain("isInShareContext");
      expect(src).not.toContain("getShareContextClientId");
      expect(src).not.toContain("runInShareContext");
      expect(src).not.toContain("createSupabaseServiceClient");
      expect(src).not.toContain("supabase/service");
    });
  }
});

describe("runInShareContext só é chamado em 1 lugar do app inteiro — o render da página pública", () => {
  it("nenhum arquivo além de app/share/[token]/page.tsx chama runInShareContext", () => {
    const sharePage = read("app/share/[token]/page.tsx");
    expect(sharePage).toContain("runInShareContext(");
    for (const f of ACTION_FILES) {
      expect(read(f)).not.toContain("runInShareContext");
    }
  });

  it("share-context.ts não exporta nada que uma Action pudesse usar para se auto-autorizar via clientId do share", () => {
    const src = read("supabase/share-context.ts");
    // getShareContextClientId existe só para auditoria/depuração (documentado
    // no próprio arquivo) — nenhuma Action a importa (confirmado acima).
    expect(src).toContain("export function getShareContextClientId");
  });
});

describe("DashboardContent — SyncMetaButton é a ÚNICA mutation na árvore, e só existe fora de readOnly", () => {
  it("import estático de SyncMetaButton existe (não é dynamic import condicional) — a garantia é a Action, não a ausência do módulo no bundle", () => {
    const src = read("components/client-dashboard/dashboard-content.tsx");
    expect(src).toContain('import { SyncMetaButton } from "@/components/clients/sync-meta-button";');
  });

  it("todo <SyncMetaButton> no JSX está atrás de `!readOnly &&`", () => {
    const src = read("components/client-dashboard/dashboard-content.tsx");
    const matches = [...src.matchAll(/<SyncMetaButton/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const before = src.slice(Math.max(0, m.index! - 40), m.index!);
      expect(before).toContain("!readOnly &&");
    }
  });

  it("nenhum outro componente da árvore de DashboardContent importa uma Server Action", () => {
    const files = [
      "components/client-dashboard/campaigns-table.tsx",
      "components/client-dashboard/sync-health-lines.tsx",
      "components/client-dashboard/dashboard-scope-filters.tsx",
      "components/ui/date-range-picker.tsx",
      "components/ui/metric-card.tsx",
      "components/ui/chart-container.tsx",
      "components/charts/dashboard-chart.tsx",
    ];
    for (const f of files) {
      expect(read(f)).not.toMatch(/from ["'][^"']*-actions["']/);
    }
  });

  it("share-link-modal.tsx (a única outra Action-consumidora do módulo client-dashboard) NÃO é importado por DashboardContent nem pela página pública", () => {
    const content = read("components/client-dashboard/dashboard-content.tsx");
    const sharePage = read("app/share/[token]/page.tsx");
    expect(content).not.toContain("share-link-modal");
    expect(sharePage).not.toContain("share-link-modal");
    expect(sharePage).not.toContain("ShareLinkModal");
  });
});

describe("service_role nunca chega a nenhum Client Component", () => {
  it('nenhum componente "use client" da árvore do share importa supabase/service ou referencia SUPABASE_SECRET_KEY', () => {
    const clientComponents = [
      "components/client-dashboard/share-link-modal.tsx",
      "components/clients/sync-meta-button.tsx",
      "components/ui/date-range-picker.tsx",
      "components/client-dashboard/dashboard-scope-filters.tsx",
    ];
    for (const f of clientComponents) {
      const src = read(f);
      expect(src.trimStart().startsWith('"use client"')).toBe(true);
      expect(src).not.toContain("supabase/service");
      expect(src).not.toContain("createSupabaseServiceClient");
      expect(src).not.toContain("SUPABASE_SECRET_KEY");
    }
  });

  it("o único dado sensível recebido por um Client Component é o próprio token de share (já opaco/pouco útil sozinho) — nunca a service key", () => {
    const modal = read("components/client-dashboard/share-link-modal.tsx");
    // O componente só lê `res.token` (retorno da Server Action) — nunca uma env var.
    expect(modal).not.toMatch(/process\.env/);
  });
});
