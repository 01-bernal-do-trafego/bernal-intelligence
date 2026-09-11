/**
 * Parse-guards da migration
 * 20260911173000_meta_backfill_create_job_with_segments.sql (DATA V2.3A).
 * Não roda contra o banco (não aplicada) — protege a atomicidade/validação
 * server-side/assinatura/grants que só existem no SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260911173000_meta_backfill_create_job_with_segments.sql",
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

function fnBody(): string {
  const start = active.indexOf("create or replace function public.create_backfill_job_with_segments");
  expect(start).toBeGreaterThan(-1);
  return active.slice(start);
}

describe("assinatura e grants", () => {
  it("6 parâmetros, RETURNS TABLE (job_id, segment_count)", () => {
    const fn = fnBody();
    const sig = fn.slice(0, fn.indexOf("language plpgsql"));
    expect(sig).toContain("p_client_id         uuid,");
    expect(sig).toContain("p_ad_account_ref    uuid,");
    expect(sig).toContain("p_requested_levels  public.meta_insight_level[],");
    expect(sig).toContain("p_target_start_date date,");
    expect(sig).toContain("p_target_end_date   date,");
    expect(sig).toContain("p_segments          jsonb");
    expect(sig).toContain("job_id        uuid,");
    expect(sig).toContain("segment_count integer");
  });
  it("SECURITY DEFINER, revogada de public/anon/authenticated, só service_role executa", () => {
    const fn = fnBody();
    expect(fn).toContain("security definer");
    expect(active).toMatch(
      /revoke all on function public\.create_backfill_job_with_segments\(uuid, uuid, public\.meta_insight_level\[\], date, date, jsonb\)\s*\n?\s*from public, anon, authenticated/,
    );
    expect(active).toMatch(
      /grant execute on function public\.create_backfill_job_with_segments\(uuid, uuid, public\.meta_insight_level\[\], date, date, jsonb\)\s*\n?\s*to service_role/,
    );
  });
  it("nenhuma outra função pública é criada nesta migration", () => {
    const created = [...active.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["create_backfill_job_with_segments"]);
  });
});

describe("discovery/all-history explicitamente rejeitado (só intervalo explícito nesta fase)", () => {
  it("p_target_start_date null -> raise exception (nunca inventa data)", () => {
    const fn = fnBody();
    expect(fn).toMatch(/if p_target_start_date is null then\s*\n?\s*raise exception/);
  });
  it("p_target_end_date null -> raise exception", () => {
    const fn = fnBody();
    expect(fn).toMatch(/if p_target_end_date is null then\s*\n?\s*raise exception/);
  });
});

describe("validação server-side (não confia cegamente no payload)", () => {
  it("conta pertence ao cliente e is_linked=true", () => {
    const fn = fnBody();
    expect(fn).toMatch(/a\.id = p_ad_account_ref and a\.client_id = p_client_id and a\.is_linked = true/);
  });
  it("nenhum job ativo (pending/running/paused) já existente para a conta", () => {
    const fn = fnBody();
    expect(fn).toMatch(/j\.status in \('pending', 'running', 'paused'\)/);
  });
  it("level de cada segmento precisa pertencer a p_requested_levels", () => {
    const fn = fnBody();
    expect(fn).toMatch(/not \(level = any \(p_requested_levels\)\)/);
  });
  it("segmento invertido (date_from > date_to) é rejeitado", () => {
    const fn = fnBody();
    expect(fn).toMatch(/where date_from > date_to/);
  });
  it("segmento fora do range alvo é rejeitado", () => {
    const fn = fnBody();
    expect(fn).toMatch(/date_from < p_target_start_date or date_to > p_target_end_date/);
  });
  it("segmento duplicado (mesmo level+date_from+date_to) é rejeitado", () => {
    const fn = fnBody();
    expect(fn).toMatch(/group by level, date_from, date_to having count\(\*\) > 1/);
  });
  it("overlap dentro do MESMO level é rejeitado (self-join por level, rn assimétrico)", () => {
    const fn = fnBody();
    expect(fn).toMatch(/join segs b on a\.level = b\.level and a\.rn < b\.rn/);
    expect(fn).toMatch(/a\.date_from <= b\.date_to and b\.date_from <= a\.date_to/);
  });
  it("todo level solicitado precisa ter >=1 segmento no payload", () => {
    const fn = fnBody();
    expect(fn).toMatch(/from unnest\(p_requested_levels\) as rl \(level\)/);
  });
  it("cobertura exata: sem gap (lag/date_from <> prev_date_to + 1) e limites batendo com target_start/target_end", () => {
    const fn = fnBody();
    expect(fn).toMatch(/lag\(date_to\) over \(partition by level order by date_from\)/);
    expect(fn).toMatch(/level_min <> p_target_start_date/);
    expect(fn).toMatch(/level_max <> p_target_end_date/);
    expect(fn).toMatch(/date_from <> prev_date_to \+ 1/);
  });
});

describe("atomicidade — zero job e zero segmentos se qualquer segmento for inválido", () => {
  it("TODAS as validações (exists/raise exception) acontecem ANTES do primeiro INSERT", () => {
    const fn = fnBody();
    const firstInsertIdx = fn.indexOf("insert into public.meta_backfill_jobs");
    const validationIdxs = [
      fn.indexOf("not (level = any (p_requested_levels))"),
      fn.indexOf("where date_from > date_to"),
      fn.indexOf("group by level, date_from, date_to having count(*) > 1"),
      fn.indexOf("lag(date_to) over"),
    ];
    for (const idx of validationIdxs) {
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(firstInsertIdx);
    }
  });
  it("o INSERT dos segmentos NÃO está dentro de um bloco exception (falha propaga e desfaz TUDO, job incluso)", () => {
    const fn = fnBody();
    const segInsertIdx = fn.indexOf("insert into public.meta_backfill_segments");
    const jobInsertBeginIdx = fn.indexOf("begin\n    insert into public.meta_backfill_jobs");
    const jobInsertEndIdx = fn.indexOf("end;", jobInsertBeginIdx);
    // o INSERT de segmentos deve estar DEPOIS do bloco try/exception do job (que só protege o job).
    expect(segInsertIdx).toBeGreaterThan(jobInsertEndIdx);
    // e não deve haver um NOVO "exception when" entre o fim do bloco do job e o INSERT de segmentos.
    const between = fn.slice(jobInsertEndIdx, segInsertIdx);
    expect(between).not.toContain("exception when");
  });
  it("job ativo duplicado em condição de corrida (unique_violation no INSERT) também vira exception clara", () => {
    const fn = fnBody();
    const jobInsertIdx = fn.indexOf("insert into public.meta_backfill_jobs");
    const block = fn.slice(jobInsertIdx, jobInsertIdx + 500);
    expect(block).toContain("exception when unique_violation then");
    expect(block).toContain("condição de corrida");
  });
  it("get diagnostics conta as linhas REALMENTE inseridas em segments (não confia no length do payload)", () => {
    const fn = fnBody();
    const segInsertIdx = fn.indexOf("insert into public.meta_backfill_segments");
    const afterSegInsert = fn.slice(segInsertIdx, segInsertIdx + 400);
    expect(afterSegInsert).toContain("get diagnostics v_count = row_count");
  });
});

describe("job criado pronto para claim_next_backfill_segment", () => {
  it("job inserido direto com status='running' (não pending)", () => {
    const fn = fnBody();
    const jobInsertIdx = fn.indexOf("insert into public.meta_backfill_jobs");
    const block = fn.slice(jobInsertIdx, jobInsertIdx + 400);
    expect(block).toContain("'running'");
  });
  it("segmentos inseridos com status='pending'", () => {
    const fn = fnBody();
    const segInsertIdx = fn.indexOf("insert into public.meta_backfill_segments");
    const block = fn.slice(segInsertIdx, segInsertIdx + 400);
    expect(block).toMatch(/'pending'/);
  });
});

describe("nenhuma alteração fora do escopo desta migration", () => {
  it("não cria/altera tabela/tipo/trigger/índice", () => {
    expect(active).not.toMatch(/create table/);
    expect(active).not.toMatch(/alter table/);
    expect(active).not.toMatch(/create type/);
    expect(active).not.toMatch(/create (or replace )?trigger/);
    expect(active).not.toMatch(/create index/);
  });
  it("não toca claim_next_backfill_segment/complete_backfill_segment/fail_backfill_segment/extend_backfill_segment_lease/retry", () => {
    for (const fn of [
      "claim_next_backfill_segment",
      "complete_backfill_segment",
      "fail_backfill_segment",
      "extend_backfill_segment_lease",
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
