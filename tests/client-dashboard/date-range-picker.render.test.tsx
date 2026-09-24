/**
 * BUG 01 V1.1 — Período personalizado (custom range).
 *
 * Render estático (mesmo padrão de dashboard-content.render.test.tsx):
 * `next/navigation` mockado com `useSearchParams` configurável por teste, via
 * `vi.fn()` (não `renderToStaticMarkup` fixo) — prova o que a UI mostra para
 * cada estado de URL, sem precisar do App Router montado.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSearchParamsMock = vi.fn<() => URLSearchParams>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => "/clients/c1",
  useSearchParams: () => useSearchParamsMock(),
}));

const { DateRangePicker } = await import("@/components/ui/date-range-picker");

function render(search: string, props: { showCompare?: boolean } = {}) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(search));
  return renderToStaticMarkup(<DateRangePicker {...props} />);
}

beforeEach(() => {
  useSearchParamsMock.mockReset();
});

describe("DateRangePicker — preserva os presets existentes", () => {
  it("sem ?period= : mostra o select com as 7 opções de preset + 'Período personalizado'", () => {
    const html = render("");
    for (const label of [
      "Hoje",
      "Ontem",
      "Últimos 7 dias",
      "Últimos 14 dias",
      "Últimos 30 dias",
      "Este mês",
      "Mês anterior",
      "Período personalizado",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("?period=last_30d : não mostra os inputs de data (preset comum continua sem UI de calendário)", () => {
    const html = render("period=last_30d");
    expect(html).not.toMatch(/aria-label="Data inicial"/);
    expect(html).not.toMatch(/aria-label="Data final"/);
  });
});

describe("DateRangePicker — período personalizado", () => {
  it("?period=custom&dateFrom&dateTo : mostra os dois inputs de data, pré-preenchidos com os valores da URL", () => {
    const html = render("period=custom&dateFrom=2025-05-14&dateTo=2025-06-30");
    expect(html).toMatch(/aria-label="Data inicial"/);
    expect(html).toMatch(/aria-label="Data final"/);
    expect(html).toContain('value="2025-05-14"');
    expect(html).toContain('value="2025-06-30"');
  });

  it("?period=custom sem dateFrom/dateTo (URL crua/mal-formada): não crasha, inputs vêm vazios", () => {
    expect(() => render("period=custom")).not.toThrow();
    const html = render("period=custom");
    expect(html).toMatch(/aria-label="Data inicial"/);
  });

  it("histórico real do BUG 01 (2025-05-14 -> 2026-09-13): renderiza sem erro", () => {
    expect(() =>
      render("period=custom&dateFrom=2025-05-14&dateTo=2026-09-13"),
    ).not.toThrow();
  });
});

describe("DateRangePicker — comparação com período anterior", () => {
  it("checkbox reflete ?compare=1", () => {
    const html = render("period=last_7d&compare=1");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it("showCompare=false esconde o checkbox", () => {
    const html = render("", { showCompare: false });
    expect(html).not.toContain("Comparar com período anterior");
  });
});
