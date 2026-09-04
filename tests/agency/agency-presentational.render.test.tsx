/**
 * Render de componentes presentacionais da Agency Overview (sem `next/navigation`
 * — renderizáveis via `react-dom/server` puro, mesmo padrão de
 * `tests/client-dashboard/sync-health-lines.render.test.tsx`). Os componentes
 * client-side com useRouter (tabela/gráficos) dependem do App Router e ficam
 * fora deste tipo de teste — cobertos pela lógica pura em outros arquivos.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultGroups } from "@/components/agency/result-groups";
import { HealthSummary } from "@/components/agency/health-summary";
import { HeaderStatus } from "@/components/agency/header-status";
import type { ResultGroup } from "@/lib/meta/agency-overview";

describe("ResultGroups — sem cards vazios de métrica inexistente", () => {
  it("nenhum grupo -> não renderiza nada (nem a seção)", () => {
    const html = renderToStaticMarkup(<ResultGroups groups={[]} />);
    expect(html).toBe("");
  });

  it("um grupo -> mostra só aquele tipo, com custo/resultado", () => {
    const groups: ResultGroup[] = [
      { canonicalId: "messaging_conversations_started", label: "Conversas iniciadas", spend: 932, results: 620, costPerResult: 932 / 620, clientCount: 1 },
    ];
    const html = renderToStaticMarkup(<ResultGroups groups={groups} />);
    expect(html).toContain("Conversas iniciadas");
    expect(html).toContain("620");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("resultado com custo/resultado null -> mostra travessão, nunca NaN/Infinity", () => {
    const groups: ResultGroup[] = [
      { canonicalId: "leads", label: "Leads", spend: 100, results: 0, costPerResult: null, clientCount: 1 },
    ];
    const html = renderToStaticMarkup(<ResultGroups groups={groups} />);
    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("HealthSummary", () => {
  it("renderiza as 5 contagens sem NaN/undefined", () => {
    const html = renderToStaticMarkup(
      <HealthSummary
        health={{
          fresh: 12,
          stale: 1,
          never: 1,
          lastSyncProblem: 0,
          metaNeedsAttention: 0,
          attentionCount: 2,
        }}
      />,
    );
    expect(html).toContain("12 atualizados");
    expect(html).toContain("1 atrasados");
    expect(html).toContain("1 nunca sincronizados");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("zero em tudo ainda renderiza limpo (não quebra)", () => {
    const html = renderToStaticMarkup(
      <HealthSummary
        health={{ fresh: 0, stale: 0, never: 0, lastSyncProblem: 0, metaNeedsAttention: 0, attentionCount: 0 }}
      />,
    );
    expect(html).toContain("0 atualizados");
    expect(html).not.toContain("NaN");
  });
});

describe("HeaderStatus", () => {
  it("sem atualização nenhuma -> travessão, sem linha de atenção", () => {
    const html = renderToStaticMarkup(<HeaderStatus lastUpdatedAt={null} attentionCount={0} />);
    expect(html).toContain("—");
    expect(html).not.toContain("precisa");
    expect(html).not.toContain("precisam");
  });

  it("com atenção > 0 -> mostra a contagem, singular/plural corretos", () => {
    const one = renderToStaticMarkup(
      <HeaderStatus lastUpdatedAt="2026-09-04T11:42:00Z" attentionCount={1} />,
    );
    expect(one).toContain("1 cliente precisa");
    const many = renderToStaticMarkup(
      <HeaderStatus lastUpdatedAt="2026-09-04T11:42:00Z" attentionCount={3} />,
    );
    expect(many).toContain("3 clientes precisam");
  });
});
