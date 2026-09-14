/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Parse-guards ESTÁTICOS de server/share-link.ts, supabase/service.ts e do
 * branch novo em supabase/server.ts — todos `server-only` (ou dependem de
 * módulo `server-only`), não importáveis diretamente em Vitest (o pacote
 * `server-only` não está instalado no ambiente de teste — mesma limitação
 * documentada em toda leitura de `server/*.ts` deste projeto). Lê o texto
 * fonte e valida invariantes estruturais/de segurança, sem executar nada.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const strip = (src: string) => src.slice(src.indexOf("*/") + 2);

const shareLink = read("server/share-link.ts");
const service = read("supabase/service.ts");
const server = read("supabase/server.ts");
const shareContextSrc = read("supabase/share-context.ts");

describe("server/share-link.ts — resolveShareToken (leitura pública, service_role)", () => {
  const code = strip(shareLink);

  it("é `server-only` (constrói/usa o client service_role)", () => {
    expect(shareLink).toContain('import "server-only"');
  });

  it("valida formato do token ANTES de qualquer query (isPlausibleShareToken)", () => {
    expect(code).toContain("if (!isPlausibleShareToken(rawToken)) return null;");
  });

  it("fora do modo supabase (demo/unconfigured) sempre retorna null, nunca toca no service client", () => {
    const idx = code.indexOf('if (getAuthMode() !== "supabase") return null;');
    const serviceIdx = code.indexOf("createSupabaseServiceClient()");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(serviceIdx);
  });

  it("consulta filtra SEMPRE por token_hash E is_active=true — nunca só um dos dois", () => {
    expect(code).toContain('.eq("token_hash", tokenHash)');
    expect(code).toContain('.eq("is_active", true)');
  });

  it("erro de consulta OU ausência de linha -> null (nunca distingue os dois motivos)", () => {
    expect(code).toContain("if (error || !data) return null;");
  });

  it("qualquer exceção (try/catch externo) -> null, nunca lança para o chamador", () => {
    expect(code).toMatch(/try \{[\s\S]*\} catch \{\s*\n\s*return null;\s*\n\s*\}/);
  });

  it("nunca retorna/expõe token_hash, cipher, ou qualquer coluna além de client_id", () => {
    expect(code).not.toMatch(/token_hash[^,]*:\s*(data|row)/);
    const selectCalls = [...code.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const cols of selectCalls) {
      expect(cols).not.toMatch(/cipher|token_iv|token_tag/);
    }
  });

  it("resultado nunca inclui o clientId vindo do CHAMADOR — só o resolvido do banco", () => {
    // A assinatura só recebe rawToken; nenhum parâmetro clientId é aceito.
    expect(code).toMatch(/export const resolveShareToken = cache\(async function resolveShareToken\(\s*\n?\s*rawToken: string,?\s*\n?\)/);
  });

  it("getShareLinkState usa RLS normal (createSupabaseServerClient), NUNCA o service client", () => {
    const idx = code.indexOf("export const getShareLinkState");
    const nextExportIdx = code.indexOf("export const resolveShareToken");
    const block = code.slice(idx, nextExportIdx);
    expect(block).toContain("createSupabaseServerClient()");
    expect(block).not.toContain("createSupabaseServiceClient");
  });

  it("touch de last_accessed_at é best-effort (nunca await bloqueante, nunca derruba a resolução)", () => {
    expect(code).toMatch(/void admin[\s\S]{0,200}\.then\(\s*\n?\s*\(\) => \{\},\s*\n?\s*\(\) => \{\},\s*\n?\s*\);/);
  });
});

describe("supabase/service.ts — client service_role (a única exceção documentada à regra 'app nunca usa service_role')", () => {
  it("é `server-only`", () => {
    expect(service).toContain('import "server-only"');
  });

  it("a chave vem de SUPABASE_SECRET_KEY (nunca NEXT_PUBLIC_, nunca hardcoded)", () => {
    expect(service).toContain('process.env.SUPABASE_SECRET_KEY');
    expect(service).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
  });

  it("lança (nunca retorna string vazia/undefined) quando a env está ausente", () => {
    expect(service).toMatch(/if \(!key\) \{\s*\n\s*throw new Error\(/);
  });

  it("nunca loga a chave (nenhum console.* neste arquivo)", () => {
    expect(service).not.toMatch(/console\./);
  });

  it("client sem persistência de sessão (persistSession:false, autoRefreshToken:false — mesmo padrão do Deno)", () => {
    expect(service).toContain("persistSession: false");
    expect(service).toContain("autoRefreshToken: false");
  });

  it("documenta explicitamente a exceção à regra pré-existente ('o app NUNCA usa service_role')", () => {
    expect(service).toMatch(/NUNCA usava `service_role`/);
  });
});

describe("supabase/server.ts — branch de share context", () => {
  const code = strip(server);

  it("checa isInShareContext() ANTES de tocar em cookies()", () => {
    const shareIdx = code.indexOf("isInShareContext()");
    const cookiesIdx = code.indexOf("await cookies()");
    expect(shareIdx).toBeGreaterThan(-1);
    expect(shareIdx).toBeLessThan(cookiesIdx);
  });

  it("dentro do share context devolve createSupabaseServiceClient(), não createServerClient (cookies)", () => {
    const idx = code.indexOf("if (isInShareContext())");
    const block = code.slice(idx, idx + 150);
    expect(block).toContain("createSupabaseServiceClient()");
  });

  it("fora do share context, o comportamento de cookies permanece o mesmo de antes (createServerClient com getAll/setAll)", () => {
    expect(code).toContain("createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY");
    expect(code).toContain("getAll()");
    expect(code).toContain("setAll(");
  });
});

describe("share-context.ts — nenhum vazamento de clientId para fora do módulo além dos getters expostos", () => {
  it("AsyncLocalStorage é module-scoped (não exportado diretamente)", () => {
    expect(shareContextSrc).not.toMatch(/export const shareContextStorage/);
    expect(shareContextSrc).not.toMatch(/export \{ shareContextStorage/);
  });
});
