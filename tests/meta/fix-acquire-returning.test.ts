/**
 * Parse-guards da migration aditiva
 * 20260903205700_fix_meta_sync_acquire_returning.sql
 *
 * Corrige o RETURNING ambíguo (SQLSTATE 42702) de meta_sync_acquire_client sem
 * editar a migration já aplicada 20260903193000_meta_auto_sync.sql.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fix = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260903205700_fix_meta_sync_acquire_returning.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const lower = fix.toLowerCase();

/** linhas NÃO comentadas. */
const active = fix
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("fix RETURNING — desambiguação", () => {
  it("NÃO usa RETURNING bare para ad_account_ref/connection_id", () => {
    expect(active).not.toMatch(
      /returning\s+ad_account_ref\s*,\s*connection_id\s*,\s*id/,
    );
    // toda menção a ad_account_ref/connection_id na linha do RETURNING é qualificada (msr.)
    const retLine =
      active.split("\n").find((l) => l.trim().startsWith("returning")) ?? "";
    expect(retLine).toContain("returning");
    expect(retLine).not.toMatch(/(?<!msr\.)\bad_account_ref\b/);
    expect(retLine).not.toMatch(/(?<!msr\.)\bconnection_id\b/);
  });

  it("usa alias inequívoco na tabela alvo (insert ... as msr / returning msr.<col>)", () => {
    expect(active).toMatch(
      /insert\s+into\s+public\.meta_sync_runs\s+as\s+msr\b/,
    );
    expect(active).toMatch(
      /returning\s+msr\.ad_account_ref\s*,\s*msr\.connection_id\s*,\s*msr\.id/,
    );
  });
});

describe("fix — nada mais muda", () => {
  it("mantém INSERT ... SELECT atômico a partir da view de elegibilidade", () => {
    expect(active).toMatch(
      /insert\s+into\s+public\.meta_sync_runs[\s\S]*?select[\s\S]*?from\s+public\.meta_eligible_ad_accounts/,
    );
    // um único statement: sem loop, sem múltiplos INSERT
    expect((active.match(/insert\s+into\s+public\.meta_sync_runs/g) ?? []).length).toBe(1);
  });

  it("mantém sync_batch_id compartilhado (v_batch para todos os runs)", () => {
    expect(active).toMatch(/v_batch\s+uuid\s*:=\s*pg_catalog\.gen_random_uuid\(\)/);
    expect(active).toMatch(/sync_batch_id[\s\S]*?v_batch/);
    expect(active).toMatch(/select\s+i\.ad_account_ref,\s*i\.connection_id,\s*i\.id,\s*v_batch/);
  });

  it("mantém assinatura sem p_connection_id", () => {
    const sig = active.slice(
      active.indexOf("function public.meta_sync_acquire_client"),
      active.indexOf("returns table"),
    );
    expect(sig).not.toContain("p_connection_id");
    expect(sig).toContain("p_client_id");
    expect(sig).toContain("p_trigger");
    expect(sig).toContain("p_date_from");
    expect(sig).toContain("p_date_to");
    expect(sig).toContain("p_created_by");
  });

  it("mantém RETURNS TABLE idêntico", () => {
    expect(active).toMatch(
      /returns\s+table\s*\(\s*ad_account_ref\s+uuid\s*,\s*connection_id\s+uuid\s*,\s*run_id\s+uuid\s*,\s*sync_batch_id\s+uuid\s*\)/,
    );
  });

  it("mantém SECURITY DEFINER + SET search_path = ''", () => {
    expect(active).toContain("security definer");
    expect(active).toMatch(/set\s+search_path\s*=\s*''/);
  });

  it("mantém semântica de sync_already_running / no_eligible_account", () => {
    expect(active).toMatch(
      /exception\s+when\s+unique_violation\s+then\s+raise\s+exception\s+'sync_already_running'/,
    );
    expect(active).toContain("no_eligible_account");
  });

  it("mantém os grants (revoke public/anon/authenticated; execute só service_role)", () => {
    expect(active).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.meta_sync_acquire_client\([^)]*\)\s*from\s+public,\s*anon,\s*authenticated/,
    );
    expect(active).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.meta_sync_acquire_client\([^)]*\)\s*to\s+service_role/,
    );
  });

  it("faz APENAS create or replace da função — sem DDL de tabela / sem outras funções", () => {
    expect(active).not.toMatch(/\balter\s+table\b/);
    expect(active).not.toMatch(/\bdrop\s+(function|table|view)\b/);
    expect(active).not.toMatch(/\bcreate\s+table\b/);
    // só a própria função é (re)criada
    const creates = active.match(/create\s+or\s+replace\s+function\s+public\.\w+/g) ?? [];
    expect(creates).toEqual(["create or replace function public.meta_sync_acquire_client"]);
  });

  it("NÃO referencia/edita a migration já aplicada", () => {
    expect(lower).not.toContain("drop function if exists public.meta_sync_acquire_client");
  });
});

describe("migration aplicada 20260903193000 permanece intacta", () => {
  const applied = readFileSync(
    fileURLToPath(
      new URL(
        "../../supabase/migrations/20260903193000_meta_auto_sync.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  ).toLowerCase();

  it("continua com o corpo original (RETURNING bare) — não foi editada", () => {
    expect(applied).toContain("returning ad_account_ref, connection_id, id");
  });
});
