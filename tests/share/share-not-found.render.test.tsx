/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 * Teste REAL de app/share/[token]/not-found.tsx — sem "server-only" na
 * cadeia de import (só `next` + JSX puro), renderizável direto.
 *
 * Mensagem NEUTRA: nunca diz se o token é inexistente/inválido/desativado,
 * nunca menciona client/UUID/banco. noindex/nofollow explícito.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShareNotFound, { metadata } from "@/app/share/[token]/not-found";

describe("metadata — noindex/nofollow", () => {
  it("robots.index === false e robots.follow === false", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("ShareNotFound — mensagem neutra", () => {
  const html = renderToStaticMarkup(<ShareNotFound />);

  it("mostra a mensagem neutra exigida", () => {
    expect(html).toContain("Este dashboard não está disponível.");
  });

  it("NUNCA menciona client/cliente, UUID, banco/database, ou motivo interno", () => {
    const lower = html.toLowerCase();
    expect(lower).not.toContain("client_id");
    expect(lower).not.toContain("uuid");
    expect(lower).not.toContain("database");
    expect(lower).not.toContain("token_hash");
    expect(lower).not.toContain("desativado por"); // não distingue motivo
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
