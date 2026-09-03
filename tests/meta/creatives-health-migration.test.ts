/**
 * Parse-guards da migration aditiva
 * 20260903214500_fix_creatives_health_incremental.sql
 *
 * Só a classificação de creatives_status muda; todo o resto da view
 * meta_client_sync_health permanece.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), "utf8");

const sql = read("20260903214500_fix_creatives_health_incremental.sql");
const active = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("view — recriação segura", () => {
  it("só create or replace view, security_invoker = true", () => {
    expect(active).toMatch(
      /create\s+or\s+replace\s+view\s+public\.meta_client_sync_health\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/,
    );
  });
  it("sem DDL de tabela/função/outra view; sem alter/drop", () => {
    expect(active).not.toMatch(/\balter\s+(table|view)\b/);
    expect(active).not.toMatch(/\bdrop\s+(view|table|function)\b/);
    expect(active).not.toMatch(/\bcreate\s+table\b/);
    const views = active.match(/create\s+or\s+replace\s+view\s+public\.\w+/g) ?? [];
    expect(views).toEqual(["create or replace view public.meta_client_sync_health"]);
  });
  it("grants preservados", () => {
    expect(active).toMatch(/revoke\s+all\s+on\s+public\.meta_client_sync_health\s+from\s+public,\s*anon/);
    expect(active).toMatch(
      /grant\s+select\s+on\s+public\.meta_client_sync_health\s+to\s+authenticated,\s*service_role/,
    );
  });
});

describe("view — lógica NÃO tocada", () => {
  it("performance_synced_at mantém guard de NULL (bool_or ... then null else min)", () => {
    expect(active).toMatch(/case[\s\S]*bool_or\(p\.perf_at is null\)[\s\S]*then null[\s\S]*else min\(p\.perf_at\)/);
  });
  it("runs legados via coalesce(sync_batch_id, id)", () => {
    expect(active).toMatch(/coalesce\(r\.sync_batch_id,\s*r\.id\)\s+as\s+batch_key/);
    expect(active).not.toMatch(/where\s+r?\.?sync_batch_id\s+is\s+not\s+null/);
  });
  it("mantém os 3 eixos: performance / last_sync / last_batch_id", () => {
    expect(active).toContain("as performance_status");
    expect(active).toContain("as last_sync_status");
    expect(active).toContain("br.finished_at as last_sync_at");
    expect(active).toContain("br.batch_key as last_batch_id");
  });
  it("last_sync_status: running > success > failed > partial (batch agregado)", () => {
    expect(active).toMatch(/when\s+'running'\s*=\s*any\(br\.statuses\)\s+then\s+'running'/);
    expect(active).toMatch(/br\.statuses\s*<@\s*array\['success'\]\s*then\s*'success'/);
    expect(active).toMatch(/br\.statuses\s*<@\s*array\['error'\]\s*then\s*'failed'/);
  });
});

describe("creatives_status — nova regra", () => {
  it("sem stats.creatives reconhecido -> unknown (não 'never')", () => {
    expect(active).toMatch(/when\s+br\.any_creatives\s+is\s+not\s+true\s+then\s+'unknown'/);
  });
  it("any_creatives exige objeto JSON (jsonb_typeof = 'object')", () => {
    expect(active).toMatch(
      /bool_or\(jsonb_typeof\(rk\.stats\s*->\s*'creatives'\)\s*=\s*'object'\)\s+as\s+any_creatives/,
    );
  });
  it("issue (failed/minimal_only/degraded) -> partial, ou failed se completa", () => {
    expect(active).toMatch(/unnest\(br\.cre_failed\)/);
    expect(active).toMatch(/unnest\(br\.cre_minonly\)/);
    expect(active).toMatch(/unnest\(br\.cre_degraded\)/);
    // failed completo = TODAS as contas sem salvar (bool_and) + alguma com failed
    expect(active).toMatch(/bool_and\(u\s*=\s*'0'\s+or\s+u\s*=\s*''\)\s+from\s+unnest\(br\.cre_upserted\)/);
    expect(active).toMatch(/then\s+'failed'\s*\n?\s*else\s+'partial'/);
  });
  it("caso saudável -> ok INDEPENDENTE de upserted (else 'ok', sem gate de upserted)", () => {
    // não existe mais 'when ... cre_upserted ... then ok'
    expect(active).not.toMatch(/from\s+unnest\(br\.cre_upserted\)\s+u\)\s+then\s+'ok'/);
    // o ramo final do CASE de creatives_status é 'ok'
    const creCase = active.slice(
      active.indexOf("when br.any_creatives is not true"),
      active.indexOf("end as creatives_status"),
    );
    expect(creCase).toMatch(/else\s+'ok'\s*$/);
  });
});

describe("migration aplicada 20260903193000 permanece intacta", () => {
  const applied = read("20260903193000_meta_auto_sync.sql").toLowerCase();
  it("continua com o gate antigo de upserted e 'never'", () => {
    expect(applied).toMatch(/from\s+unnest\(br\.cre_upserted\)\s+u\)\s+then\s+'ok'/);
    expect(applied).toMatch(/when\s+br\.any_creatives\s+is\s+not\s+true\s+then\s+'never'/);
  });
});
