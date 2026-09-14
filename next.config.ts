import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
   *
   * O token do link compartilhável É a credencial (bearer) — e vai na URL.
   * Dois riscos específicos dela vazar:
   *   1. `Referer` para um recurso de terceiro linkado a partir da página
   *      (ex.: um link externo dentro do dashboard) — vazaria a URL completa
   *      (com o token) pro `Referer` da requisição de saída.
   *   2. Cache compartilhado/CDN guardando a resposta e servindo o dashboard
   *      de um cliente para outro visitante.
   *
   * `force-dynamic` (em app/share/[token]/page.tsx) já impede pré-render
   * estático, mas não é uma prova de header HTTP — os dois headers abaixo
   * são o mecanismo explícito e correto do Next para isto (config-level,
   * aplica no proxy/edge antes mesmo da página rodar). Escopado SÓ à rota
   * `/share/:token` — não altera a política global do resto do app.
   */
  async headers() {
    return [
      {
        source: "/share/:token",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
