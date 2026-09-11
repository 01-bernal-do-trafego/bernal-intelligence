/**
 * Parse-guards da migration 20260911171000_meta_backfill_auto_complete_job.sql
 * (DATA V2.2.4). Não roda contra o banco (não aplicada) — protege a
 * atomicidade/fencing/assinatura da auto-finalização de job que só existe
 * no SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260911171000_meta_backfill_auto_complete_job.sql", import.meta.url),
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

function fnBody(): string {
  const start = active.indexOf("create or replace function public.complete_backfill_segment");
  expect(start).toBeGreaterThan(-1);
  return active.slice(start);
}

describe("K) assinatura pública INALTERADA", () => {
  it("mesmos 5 parâmetros, na mesma ordem, mesmos defaults", () => {
    const fn = fnBody();
    const sigBlock = fn.slice(0, fn.indexOf("returns boolean"));
    expect(sigBlock).toContain("p_segment_id    uuid,");
    expect(sigBlock).toContain("p_lease_token   uuid,");
    expect(sigBlock).toContain("p_rows_written  integer default null,");
    expect(sigBlock).toContain("p_pages_fetched integer default null,");
    expect(sigBlock).toContain("p_outcome       public.meta_backfill_segment_status default 'done'");
  });
  it("mesmo tipo de retorno (boolean) e nenhuma outra função pública é criada nesta migration", () => {
    const fn = fnBody();
    expect(fn.slice(0, 500)).toContain("returns boolean");
    const created = [...active.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["complete_backfill_segment"]);
  });
  it("revoke/grant idênticos (mesma assinatura completa nos privilégios)", () => {
    expect(active).toMatch(
      /revoke all on function public\.complete_backfill_segment\(uuid, uuid, integer, integer, public\.meta_backfill_segment_status\)\s*\n?\s*from public, anon, authenticated/,
    );
    expect(active).toMatch(
      /grant execute on function public\.complete_backfill_segment\(uuid, uuid, integer, integer, public\.meta_backfill_segment_status\)\s*\n?\s*to service_role/,
    );
  });
});

describe("G) fencing preservado — job só é tocado se o UPDATE do segmento afetou >0 linhas", () => {
  it("returning job_id into v_job_id, seguido de get diagnostics e `if v_n = 0 then return false`", () => {
    const fn = fnBody();
    expect(fn).toMatch(/returning job_id into v_job_id/);
    const returningIdx = fn.indexOf("returning job_id into v_job_id");
    const afterReturning = fn.slice(returningIdx, returningIdx + 300);
    expect(afterReturning).toMatch(/get diagnostics v_n = row_count/);
    expect(afterReturning).toMatch(/if v_n = 0 then\s*\n?\s*return false/);
  });
  it("o UPDATE do job (auto-finalização) só aparece DEPOIS do `if v_n = 0 then return false`", () => {
    const fn = fnBody();
    const guardIdx = fn.indexOf("if v_n = 0 then");
    const jobUpdateIdx = fn.indexOf("update public.meta_backfill_jobs");
    expect(jobUpdateIdx).toBeGreaterThan(guardIdx);
  });
  it("a mesma condição de fencing de sempre continua no UPDATE do segmento (status/lease_token/lease_expires_at)", () => {
    const fn = fnBody();
    const segmentUpdateBlock = fn.slice(0, fn.indexOf("returning job_id"));
    expect(segmentUpdateBlock).toContain("status = 'running'");
    expect(segmentUpdateBlock).toContain("lease_token = p_lease_token");
    expect(segmentUpdateBlock).toContain("lease_expires_at is not null");
    expect(segmentUpdateBlock).toMatch(/lease_expires_at > now\(\)/);
  });
});

describe("2/3) regra de auto-finalização — WHERE do UPDATE de job", () => {
  function jobUpdateBlock(): string {
    const fn = fnBody();
    const idx = fn.indexOf("update public.meta_backfill_jobs");
    return fn.slice(idx, fn.indexOf("return true;"));
  }

  it("exige job.status = 'running' (nenhum outro status é tocado)", () => {
    expect(jobUpdateBlock()).toContain("j.status = 'running'");
  });
  it("exige EXISTS >= 1 segmento do job", () => {
    const block = jobUpdateBlock();
    expect(block).toMatch(/and exists \(\s*\n?\s*select 1 from public\.meta_backfill_segments s where s\.job_id = j\.id\s*\n?\s*\)/);
  });
  it("exige NOT EXISTS segmento pending/running/failed do job", () => {
    const block = jobUpdateBlock();
    expect(block).toMatch(/and not exists \(/);
    expect(block).toMatch(/s\.status in \('pending', 'running', 'failed'\)/);
  });
  it("o resultado final é sempre status = 'completed' — NUNCA 'exhausted'", () => {
    const block = jobUpdateBlock();
    expect(block).toContain("set status = 'completed'");
    expect(block).not.toContain("exhausted");
  });
  it("a FUNÇÃO em si (corpo executável) nunca escreve 'exhausted' — a menção em prosa no `comment on function` é só a explicação da decisão de design", () => {
    const fn = fnBody();
    const bodyOnly = fn.slice(0, fn.indexOf("$$;") + 3);
    expect(bodyOnly).not.toContain("exhausted");
  });
});

describe("5) atomicidade — sem segunda RPC, tudo dentro da mesma função", () => {
  it("só existe 1 UPDATE em meta_backfill_segments e 1 UPDATE em meta_backfill_jobs, nesta ordem", () => {
    const fn = fnBody();
    const segUpdateIdx = fn.indexOf("update public.meta_backfill_segments");
    const jobUpdateIdx = fn.indexOf("update public.meta_backfill_jobs");
    expect(segUpdateIdx).toBeGreaterThan(-1);
    expect(jobUpdateIdx).toBeGreaterThan(segUpdateIdx);
    // nenhuma OUTRA ocorrência de update nessas tabelas na função.
    const updates = [...fn.matchAll(/update public\.(meta_backfill_segments|meta_backfill_jobs)/g)];
    expect(updates).toHaveLength(2);
  });
  it("nenhuma chamada a outra função/RPC dentro do corpo (perform/select ...(...)) — só SQL direto", () => {
    const fn = fnBody();
    expect(fn).not.toMatch(/perform public\./);
    expect(fn).not.toMatch(/select public\.\w+\(/);
  });
});

describe("7) concorrência — sem lock global novo", () => {
  it("nenhum pg_advisory_lock/pg_advisory_xact_lock nesta migration", () => {
    expect(active).not.toContain("pg_advisory");
  });
});

describe("nenhuma alteração fora do escopo desta migration", () => {
  it("não cria/altera/dropa tabela, tipo, trigger ou índice", () => {
    expect(active).not.toMatch(/create table/);
    expect(active).not.toMatch(/alter table/);
    expect(active).not.toMatch(/create type/);
    expect(active).not.toMatch(/create (or replace )?trigger/);
    expect(active).not.toMatch(/create index/);
  });
  it("não toca fail_backfill_segment/extend_backfill_segment_lease/claim_next_backfill_segment/meta_backfill_retry_eligible_segments", () => {
    for (const fn of [
      "fail_backfill_segment",
      "extend_backfill_segment_lease",
      "claim_next_backfill_segment",
      "meta_backfill_retry_eligible_segments",
    ]) {
      expect(active).not.toMatch(new RegExp(`create (or replace )?function public\\.${fn}`));
    }
  });
  it("não toca meta_sync_*, Cron", () => {
    expect(active).not.toContain("meta_sync_runs");
    expect(active).not.toContain("meta_sync_acquire_client");
    expect(active).not.toContain("meta_sync_release");
    expect(active).not.toContain("cron.schedule");
  });
});
