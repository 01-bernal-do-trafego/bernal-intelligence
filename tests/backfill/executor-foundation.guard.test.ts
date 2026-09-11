/**
 * Parse-guards da migration 20260911110000_meta_backfill_executor_foundation.sql.
 * Não roda contra o banco (não aplicada) — protege o fencing (compare-and-set
 * por lease_token) das RPCs de finalização/heartbeat/retry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260911110000_meta_backfill_executor_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function activeLines(): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const active = activeLines().toLowerCase();

function fnBody(name: string, nextName?: string): string {
  const start = active.indexOf(`create or replace function public.${name}`);
  expect(start, `função ${name} não encontrada`).toBeGreaterThan(-1);
  const end = nextName ? active.indexOf(`create or replace function public.${nextName}`) : active.length;
  return active.slice(start, end);
}

describe("10. fencing — complete_backfill_segment", () => {
  const fn = () => fnBody("complete_backfill_segment", "fail_backfill_segment");

  it("stale lease token NÃO finaliza — WHERE exige status=running AND lease_token = p_lease_token", () => {
    expect(fn()).toMatch(/where id = p_segment_id\s*\n?\s*and status = 'running'\s*\n?\s*and lease_token = p_lease_token/);
  });
  it("LEASE EXPIRADA NÃO finaliza — WHERE também exige lease_expires_at > now()", () => {
    const body = fn();
    const whereClause = body.slice(body.indexOf("where id = p_segment_id"));
    expect(whereClause).toContain("and lease_expires_at is not null");
    expect(whereClause).toMatch(/and lease_expires_at > now\(\)/);
  });
  it("zera claimed_at/lease_token/lease_expires_at ao terminar (SEMÂNTICA ÚNICA: só running tem os 3 preenchidos)", () => {
    const body = fn();
    const setClause = body.slice(
      body.indexOf("update public.meta_backfill_segments"),
      body.indexOf("where id = p_segment_id"),
    );
    expect(setClause).toMatch(/claimed_at\s*=\s*null/);
    expect(setClause).toMatch(/lease_token\s*=\s*null/);
    expect(setClause).toMatch(/lease_expires_at\s*=\s*null/);
  });
  it("rejeita rows_written/pages_fetched negativos", () => {
    expect(fn()).toMatch(/p_rows_written < 0/);
    expect(fn()).toMatch(/p_pages_fetched < 0/);
  });
  it("token atual finaliza — devolve true só quando row_count > 0", () => {
    expect(fn()).toContain("get diagnostics v_n = row_count");
    expect(fn()).toContain("return v_n > 0");
  });
  it("aceita só outcome done/skipped_no_data (rejeita qualquer outro)", () => {
    expect(fn()).toContain("if p_outcome not in ('done', 'skipped_no_data') then");
    expect(fn()).toContain("raise exception");
  });
  it("é SECURITY DEFINER, só service_role", () => {
    expect(fn()).toContain("security definer");
    expect(active).toMatch(
      /grant execute on function public\.complete_backfill_segment\([^)]*\)\s*\n?\s*to service_role/,
    );
  });
});

describe("10. fencing — fail_backfill_segment", () => {
  const fn = () => fnBody("fail_backfill_segment", "extend_backfill_segment_lease");

  it("failure respeita o MESMO fencing (status=running AND lease_token)", () => {
    expect(fn()).toMatch(/where id = p_segment_id\s*\n?\s*and status = 'running'\s*\n?\s*and lease_token = p_lease_token/);
  });
  it("LEASE EXPIRADA NÃO falha o segmento — WHERE também exige lease_expires_at > now()", () => {
    const body = fn();
    const whereClause = body.slice(body.indexOf("where id = p_segment_id"));
    expect(whereClause).toContain("and lease_expires_at is not null");
    expect(whereClause).toMatch(/and lease_expires_at > now\(\)/);
  });
  it("zera claimed_at/lease_token/lease_expires_at ao falhar (SEMÂNTICA ÚNICA: só running tem os 3 preenchidos)", () => {
    const body = fn();
    const setClause = body.slice(
      body.indexOf("update public.meta_backfill_segments"),
      body.indexOf("where id = p_segment_id"),
    );
    expect(setClause).toMatch(/claimed_at\s*=\s*null/);
    expect(setClause).toMatch(/lease_token\s*=\s*null/);
    expect(setClause).toMatch(/lease_expires_at\s*=\s*null/);
  });
  it("marca status='failed' e devolve true/false pelo fencing", () => {
    expect(fn()).toContain("status           = 'failed'");
    expect(fn()).toContain("return v_n > 0");
  });
  it("é SECURITY DEFINER, só service_role", () => {
    expect(fn()).toContain("security definer");
    expect(active).toMatch(
      /grant execute on function public\.fail_backfill_segment\([^)]*\)\s*\n?\s*to service_role/,
    );
  });
});

describe("11. heartbeat — extend_backfill_segment_lease", () => {
  const fn = () => fnBody("extend_backfill_segment_lease", "meta_backfill_retry_eligible_segments");

  it("respeita o MESMO fencing (status=running AND lease_token)", () => {
    expect(fn()).toMatch(/where id = p_segment_id\s*\n?\s*and status = 'running'\s*\n?\s*and lease_token = p_lease_token/);
  });
  it("LEASE EXPIRADA NÃO renova (não se ressuscita sozinha) — WHERE exige lease_expires_at > now()", () => {
    const body = fn();
    const whereClause = body.slice(body.indexOf("where id = p_segment_id"));
    expect(whereClause).toContain("and lease_expires_at is not null");
    expect(whereClause).toMatch(/and lease_expires_at > now\(\)/);
  });
  it("p_lease precisa ser positivo — zero/negativo é rejeitado antes do UPDATE", () => {
    expect(fn()).toMatch(/if p_lease is null or p_lease <= interval '0' then/);
  });
  it("ESTENDE via GREATEST — nunca encurta a lease atual — e NÃO muda status (não é uma transição)", () => {
    const body = fn();
    const setClause = body.slice(
      body.indexOf("update public.meta_backfill_segments"),
      body.indexOf("where id = p_segment_id"),
    );
    expect(setClause).toMatch(/set lease_expires_at = greatest\(lease_expires_at, now\(\) \+ p_lease\)/);
    expect(setClause).not.toMatch(/status\s*=/);
  });
  it("mantém o MESMO lease_token (não rotaciona no heartbeat)", () => {
    expect(fn()).not.toMatch(/lease_token\s*=\s*pg_catalog\.gen_random_uuid/);
  });
});

describe("12. retry foundation — meta_backfill_retry_eligible_segments", () => {
  const fn = () => fnBody("meta_backfill_retry_eligible_segments");

  it("só segmentos failed elegíveis por next_retry_at (null ou já passado)", () => {
    expect(fn()).toContain("status = 'failed'");
    expect(fn()).toMatch(/next_retry_at is null or next_retry_at <= now\(\)/);
  });
  it("move para pending (retry do SEGMENTO)", () => {
    expect(fn()).toMatch(/set status\s*=\s*'pending'/);
  });
  it("zera lease_token/lease_expires_at/claimed_at ao reabrir (sem posse residual)", () => {
    const body = fn();
    expect(body).toMatch(/lease_token\s*=\s*null/);
    expect(body).toMatch(/lease_expires_at\s*=\s*null/);
    expect(body).toMatch(/claimed_at\s*=\s*null/);
  });
  it("NÃO reseta attempt_count nem limpa last_error_code (histórico preservado)", () => {
    const body = fn();
    expect(body).not.toMatch(/attempt_count\s*=/);
    expect(body).not.toMatch(/last_error_code\s*=/);
  });
  it("é SECURITY DEFINER, só service_role, sem Cron chamando-a", () => {
    expect(fn()).toContain("security definer");
    expect(active).toMatch(
      /grant execute on function public\.meta_backfill_retry_eligible_segments\(\)\s*\n?\s*to service_role/,
    );
    expect(active).not.toContain("cron.schedule");
  });
});

describe("JOB failed continua terminal — nenhuma RPC de retry de JOB é criada", () => {
  it("nenhuma função altera meta_backfill_jobs.status", () => {
    expect(active).not.toMatch(/update public\.meta_backfill_jobs/);
  });
  it("só existem as 4 RPCs esperadas nesta migration", () => {
    const created = [...active.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(
      [
        "complete_backfill_segment",
        "extend_backfill_segment_lease",
        "fail_backfill_segment",
        "meta_backfill_retry_eligible_segments",
      ].sort(),
    );
  });
});

describe("nenhuma alteração fora do escopo desta migration", () => {
  it("não cria/altera tabela, não toca meta_sync_runs/health/Cron/rate budget", () => {
    expect(active).not.toMatch(/create table/);
    expect(active).not.toMatch(/alter table/);
    expect(active).not.toContain("meta_sync_runs");
    expect(active).not.toContain("meta_client_sync_health");
    expect(active).not.toContain("cron.schedule");
    expect(active).not.toContain("meta_rate_budget");
  });
  it("nenhuma chamada real à Meta (sem fetch/graph.facebook.com)", () => {
    expect(active).not.toContain("graph.facebook.com");
    expect(active).not.toContain("http");
  });
});
