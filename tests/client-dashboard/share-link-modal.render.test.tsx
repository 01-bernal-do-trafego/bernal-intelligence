/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Render estático do modal "Compartilhar dashboard": prova o contrato de
 * "revelar uma vez" pelos DOIS estados iniciais possíveis (`initialActive`
 * vindo do servidor) — o token em claro NUNCA é relido do banco, então
 * mesmo com um link ativo o render inicial não tem URL nenhuma para
 * mostrar (só apareceria depois de um clique real em Gerar/Regenerar, que
 * `renderToStaticMarkup` não exercita — comportamento pós-clique é
 * responsabilidade das Server Actions, cobertas em
 * tests/share/share-link-actions.test.ts).
 *
 * Modal real usa `createPortal` (precisa de `document`, indisponível no
 * ambiente "node" do Vitest) — mesmo padrão de
 * dashboard-editor.render.test.tsx: mocka só o CASCO do Modal.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    title,
    description,
    children,
    footer,
  }: {
    title: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <div data-testid="modal">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  ),
}));
vi.mock("@/app/(app)/clients/[id]/share-actions", () => ({
  regenerateShareLink: vi.fn(async () => ({ ok: true, token: "x".repeat(43) })),
  deactivateShareLink: vi.fn(async () => ({ ok: true })),
}));

const { ShareLinkModal } = await import("@/components/client-dashboard/share-link-modal");

describe("ShareLinkModal — sem link ativo", () => {
  const html = renderToStaticMarkup(
    <ShareLinkModal clientId="c1" initialActive={false} />,
  );

  it("mostra 'Compartilhar dashboard' + o texto de criar link + botão 'Gerar link'", () => {
    expect(html).toContain("Compartilhar dashboard");
    expect(html).toContain("Crie um link somente leitura para este cliente.");
    expect(html).toContain("Gerar link");
  });

  it("NÃO mostra badge Ativo, URL, nem botão Desativar", () => {
    expect(html).not.toContain("Ativo");
    expect(html).not.toContain("Desativar");
    expect(html).not.toContain("/share/");
  });

  it('NÃO mostra mais o texto legado "Recurso previsto para uma fase futura"', () => {
    expect(html).not.toContain("Recurso previsto para uma fase futura");
  });
});

describe("ShareLinkModal — com link ativo (revelar uma vez: sem token relido do banco)", () => {
  const html = renderToStaticMarkup(
    <ShareLinkModal clientId="c1" initialActive />,
  );

  it("mostra badge 'Ativo' e os botões 'Regenerar link' / 'Desativar'", () => {
    expect(html).toContain("Ativo");
    expect(html).toContain("Regenerar link");
    expect(html).toContain("Desativar");
  });

  it("NÃO mostra nenhuma URL /share/ no render inicial (nunca relê o token do banco)", () => {
    expect(html).not.toContain("/share/");
  });

  it("mostra o aviso de que a URL não pode ser vista de novo sem regenerar", () => {
    expect(html).toContain("Já copiado anteriormente");
  });
});
