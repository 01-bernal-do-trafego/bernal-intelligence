/**
 * Guarda de segurança/isolamento da Agency Overview (READ-ONLY, sem DB real):
 *  - o módulo de dados só usa o cliente Supabase LIGADO À SESSÃO (RLS via
 *    `can_access_client`), nunca um client admin/service_role;
 *  - os componentes de UI não importam Supabase — só recebem props do server.
 *
 * Esta app NEXT NÃO TEM um construtor de client admin (só existe nas Edge
 * Functions, atrás de `resolveSecretKey`) — `createSupabaseServerClient` é a
 * única opção do lado servidor, então a garantia real está na ARQUITETURA,
 * não só na convenção. Isto é um parse-guard que protege contra regressão.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("server/agency-overview.ts — isolamento por RLS", () => {
  const src = read("server/agency-overview.ts");

  it("usa createSupabaseServerClient (RLS de sessão), nunca um client admin", () => {
    expect(src).toContain('import { createSupabaseServerClient } from "@/supabase/server"');
    expect(src).not.toMatch(/service_role|SERVICE_ROLE|resolveSecretKey|createAdminClient/i);
  });
  it("toda query de cliente usa .in(\"client_id\", clientIds) derivado da própria sessão", () => {
    // clientIds vem SEMPRE de activeClients (já filtrado por RLS), nunca de input externo.
    expect(src).toMatch(/const clientIds = activeClients\.map/);
    expect((src.match(/\.in\(\s*"client_id",\s*clientIds\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("marcado server-only", () => {
    expect(src.trimStart().startsWith('import "server-only"')).toBe(true);
  });
});

describe("components/agency/* — nenhuma UI toca Supabase diretamente", () => {
  const dir = fileURLToPath(new URL("../../components/agency", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it("existe pelo menos os componentes esperados", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file} não importa supabase/service role`, () => {
      const content = readFileSync(`${dir}/${file}`, "utf8");
      expect(content).not.toMatch(/supabase|service_role|SERVICE_ROLE/i);
    });
  }
});
