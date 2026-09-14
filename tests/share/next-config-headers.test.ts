/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link — Security Hardening.
 *
 * Teste REAL: next.config.ts não tem "server-only" nem dependências
 * pesadas — importa o config de verdade e chama `.headers()` diretamente
 * (é uma função pura de config, sem runtime do Next necessário).
 *
 * Prova: /share/:token recebe Referrer-Policy: no-referrer e
 * Cache-Control: private, no-store — e NADA MAIS no app ganha esses headers
 * (a política global não foi alterada).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config.ts#headers() — só /share/:token, nunca a política global", () => {
  it("headers() está definido", () => {
    expect(typeof nextConfig.headers).toBe("function");
  });

  it("existe exatamente 1 regra, escopada a /share/:token", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/share/:token");
  });

  it("Referrer-Policy: no-referrer", async () => {
    const rules = await nextConfig.headers!();
    const referrer = rules[0].headers.find((h) => h.key === "Referrer-Policy");
    expect(referrer?.value).toBe("no-referrer");
  });

  it("Cache-Control: private, no-store", async () => {
    const rules = await nextConfig.headers!();
    const cache = rules[0].headers.find((h) => h.key === "Cache-Control");
    expect(cache?.value).toBe("private, no-store");
  });

  it("nenhuma regra com source \"/:path*\" ou \"/(.*)\" (não é política global)", async () => {
    const rules = await nextConfig.headers!();
    for (const rule of rules) {
      expect(rule.source).not.toBe("/:path*");
      expect(rule.source).not.toMatch(/^\/\(\.\*\)$/);
      expect(rule.source.startsWith("/share/")).toBe(true);
    }
  });
});

describe("nenhum sitemap inclui /share (o app não tem sitemap.ts/robots.ts algum ainda)", () => {
  it("app/sitemap.ts e app/robots.ts não existem — nada para listar /share por engano", () => {
    for (const p of ["app/sitemap.ts", "app/robots.ts", "public/robots.txt", "public/sitemap.xml"]) {
      expect(existsSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)))).toBe(false);
    }
  });
});
