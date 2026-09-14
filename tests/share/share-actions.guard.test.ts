/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Parse-guard de app/(app)/clients/[id]/share-actions.ts ("use server" ->
 * puxa supabase/auth.ts -> "server-only", não importável em Vitest).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../app/(app)/clients/[id]/share-actions.ts", import.meta.url)),
  "utf8",
);
const code = src.slice(src.indexOf("*/") + 2);

describe("autorização — admin autenticado e autorizado ao client, nunca só o clientId do form", () => {
  it('é "use server" (Server Action, não Route Handler solto)', () => {
    expect(src.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("requireManageableClient checa sessão -> papel de agência -> getClientRecord (RLS), nessa ordem", () => {
    const idx = code.indexOf("async function requireManageableClient");
    const block = code.slice(idx, idx + 500);
    const userIdx = block.indexOf("getSessionContext()");
    const roleIdx = block.indexOf("isAgencyRole(profile.role)");
    const clientIdx = block.indexOf("getClientRecord(clientId)");
    expect(userIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeLessThan(roleIdx);
    expect(roleIdx).toBeLessThan(clientIdx);
  });

  it("sem sessão -> reason 'session'; sem papel de agência -> 'forbidden'; client inacessível (RLS) -> 'not_found'", () => {
    expect(code).toContain('reason: "session"');
    expect(code).toContain('reason: "forbidden"');
    expect(code).toContain('reason: "not_found"');
  });

  it("regenerateShareLink e deactivateShareLink SEMPRE chamam requireManageableClient antes de qualquer escrita", () => {
    const bounds = [
      code.indexOf("export async function regenerateShareLink("),
      code.indexOf("export async function deactivateShareLink("),
      code.length,
    ];
    for (let i = 0; i < 2; i++) {
      const body = code.slice(bounds[i], bounds[i + 1]);
      const guardIdx = body.indexOf("requireManageableClient(clientId)");
      const writeIdx = body.search(/\.from\("dashboard_share_links"\)/);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(writeIdx).toBeGreaterThan(guardIdx);
    }
  });
});

describe("token em claro — só existe na resposta, nunca persistido/relido", () => {
  it("o que é gravado no banco é SEMPRE token_hash, nunca a variável `token`", () => {
    const upsertIdx = code.indexOf(".upsert(");
    const block = code.slice(upsertIdx, upsertIdx + 300);
    expect(block).toContain("token_hash: tokenHash");
    expect(block).not.toMatch(/token_hash:\s*token\b/);
  });

  it("hashShareToken vem antes do upsert (o hash, não o token, é o que vai pro banco)", () => {
    const hashIdx = code.indexOf("hashShareToken(token)");
    const upsertIdx = code.indexOf(".upsert(");
    expect(hashIdx).toBeGreaterThan(-1);
    expect(hashIdx).toBeLessThan(upsertIdx);
  });

  it("o token em claro só é devolvido no retorno de regenerateShareLink, nunca lido de volta do banco em nenhuma função", () => {
    expect(code).not.toMatch(/\.select\([^)]*token(?!_hash)/i);
  });
});

describe("upsert é sempre 1 linha por client_id — nunca cria um segundo link ativo", () => {
  it('onConflict: "client_id" (upsert na MESMA linha, client_id é a PK)', () => {
    expect(code).toContain('{ onConflict: "client_id" }');
  });

  it("deactivateShareLink é UPDATE (nunca DELETE/insert)", () => {
    const idx = code.indexOf("export async function deactivateShareLink");
    const block = code.slice(idx);
    expect(block).toContain(".update({ is_active: false })");
    expect(block).not.toMatch(/\.delete\(\)/);
    expect(block).not.toMatch(/\.insert\(/);
  });
});

describe("nenhum uso de service_role aqui (gestão roda na sessão normal do admin)", () => {
  it("não importa createSupabaseServiceClient", () => {
    expect(src).not.toContain("createSupabaseServiceClient");
    expect(src).not.toContain("supabase/service");
  });
});
