/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link — AUTH FIX.
 *
 * Regressão do bug real observado em aba anônima: `/share/<token>`
 * redirecionava para `/login` porque `PUBLIC_PATHS` (supabase/proxy.ts) só
 * continha `"/login"`. Corrigido manualmente para `["/login", "/share"]`.
 *
 * Teste REAL: supabase/proxy.ts não tem "server-only" nem cadeia de import
 * pesada — `@supabase/ssr` (createServerClient) é mockado para controlar
 * `auth.getUser()` deterministicamente (sem rede), `@/supabase/config` é
 * mockado só para fixar `getAuthMode() -> "supabase"` (o branch real que
 * checa sessão — "demo"/"unconfigured" já liberam/bloqueiam tudo, sem
 * graça). `updateSession` é chamado de verdade com um `NextRequest` real.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

let mockUser: { id: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
    },
  }),
}));
vi.mock("@/supabase/config", () => ({
  getAuthMode: () => "supabase",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
}));

const { updateSession } = await import("@/supabase/proxy");

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

function redirectLocation(res: Response): string | null {
  return res.headers.get("location");
}

describe("PUBLIC_PATHS — exatamente /login e /share, nada além disso", () => {
  it("/login continua público, mesmo sem sessão (não redireciona)", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/login"));
    expect(redirectLocation(res)).toBeNull();
  });

  it("/share/<token> é público, mesmo sem sessão (não redireciona para /login)", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/share/aBcD1234xyz"));
    const loc = redirectLocation(res);
    expect(loc).toBeNull();
  });

  it("/share (sem token) também é público", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/share"));
    expect(redirectLocation(res)).toBeNull();
  });

  it("rota administrativa (/clients) continua protegida — sem sessão -> redirect para /login", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/clients"));
    const loc = redirectLocation(res);
    expect(loc).not.toBeNull();
    expect(new URL(loc!).pathname).toBe("/login");
  });

  it("usuário sem sessão em QUALQUER rota privada continua indo para /login (raiz, /clients/x, /settings)", async () => {
    mockUser = null;
    for (const path of ["/", "/clients/123", "/settings", "/intelligence", "/templates"]) {
      const res = await updateSession(makeRequest(path));
      const loc = redirectLocation(res);
      expect(loc, `esperava redirect em ${path}`).not.toBeNull();
      expect(new URL(loc!).pathname).toBe("/login");
    }
  });

  it("redirect para /login preserva redirectTo=<rota original> (comportamento pré-existente, intocado)", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/clients"));
    const loc = new URL(redirectLocation(res)!);
    expect(loc.searchParams.get("redirectTo")).toBe("/clients");
  });

  it("usuário COM sessão em /clients não é redirecionado (rota protegida funciona normalmente)", async () => {
    mockUser = { id: "u1" };
    const res = await updateSession(makeRequest("/clients"));
    expect(redirectLocation(res)).toBeNull();
  });

  it("usuário COM sessão em /share/<token> também não é redirecionado (staff pode abrir o próprio link)", async () => {
    mockUser = { id: "u1" };
    const res = await updateSession(makeRequest("/share/aBcD1234xyz"));
    expect(redirectLocation(res)).toBeNull();
  });

  it('PUBLIC_PATHS não foi ampliado além de "/login" e "/share" (lê o texto fonte — nenhuma 3ª rota pública)', async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../../supabase/proxy.ts", import.meta.url)),
      "utf8",
    );
    const match = src.match(/const PUBLIC_PATHS = (\[[^\]]*\]);/);
    expect(match).not.toBeNull();
    const paths = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(paths).toEqual(["/login", "/share"]);
  });

  it("isPublic não trata prefixo parcial como público (ex.: /sharewhatever NÃO é /share)", async () => {
    mockUser = null;
    const res = await updateSession(makeRequest("/sharewhatever"));
    const loc = redirectLocation(res);
    expect(loc).not.toBeNull();
    expect(new URL(loc!).pathname).toBe("/login");
  });
});
