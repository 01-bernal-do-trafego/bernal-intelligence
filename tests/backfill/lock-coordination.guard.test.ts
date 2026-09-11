/**
 * Parse-guards da migration 20260911100000_meta_backfill_sync_lock_coordination.sql.
 * Não roda contra o banco (não aplicada) — protege a coordenação atômica
 * Current Sync × Backfill que só existe no SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260911100000_meta_backfill_sync_lock_coordination.sql",
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

describe("1/3. chave de lock compartilhada — mesma nos dois lados", () => {
  it("meta_backfill_account_lock_key existe e deriva de hashtext(ad_account_ref)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_account_lock_key"));
    expect(fn).toContain("pg_catalog.hashtext(p_ad_account_ref::text)");
  });
  it("meta_sync_acquire_client usa o MESMO namespace (77771) e a MESMA função de chave", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("create or replace function public.claim_next_backfill_segment"),
    );
    expect(fn).toMatch(
      /pg_catalog\.pg_advisory_xact_lock\(\s*77771,\s*public\.meta_backfill_account_lock_key\(v_account\.ad_account_ref\)\s*\)/,
    );
  });
  it("claim_next_backfill_segment usa o MESMO namespace (77771) e a MESMA função de chave", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    expect(fn).toMatch(
      /pg_catalog\.pg_advisory_xact_lock\(\s*77771,\s*public\.meta_backfill_account_lock_key\(v_account_ref\)\s*\)/,
    );
  });
});

describe("2. Current Sync recusa se backfill running (mesma conta)", () => {
  it("meta_sync_acquire_client, sob o lock, checa meta_backfill_segments running e levanta sync_already_running", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("create or replace function public.claim_next_backfill_segment"),
    );
    const lockIdx = fn.indexOf("pg_advisory_xact_lock");
    const checkBlock = fn.slice(lockIdx, lockIdx + 400);
    expect(checkBlock).toMatch(/from public\.meta_backfill_segments s/);
    expect(checkBlock).toMatch(/join public\.meta_backfill_jobs j on j\.id = s\.job_id/);
    expect(checkBlock).toContain("s.status = 'running'");
    expect(checkBlock).toContain("raise exception 'sync_already_running'");
  });
  it("reaproveita a MESMA string de exceção do caso existente (sync-core.ts não muda)", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("create or replace function public.claim_next_backfill_segment"),
    );
    const hits = [...fn.matchAll(/raise exception 'sync_already_running'/g)];
    expect(hits.length).toBeGreaterThanOrEqual(2); // 1 do check de backfill + 1 do unique_violation existente
  });
});

describe("3. Backfill recusa se Current Sync running (mesma conta)", () => {
  it("claim_next_backfill_segment, sob o lock, recheca meta_sync_runs running e desiste (sem erro)", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    const lockIdx = fn.indexOf("pg_advisory_xact_lock");
    const checkBlock = fn.slice(lockIdx, lockIdx + 400);
    expect(checkBlock).toMatch(/from public\.meta_sync_runs r/);
    expect(checkBlock).toContain("r.status = 'running'");
    expect(checkBlock).toMatch(/if exists[\s\S]*then\s*\n?\s*return;/); // devolve, não lança
  });
});

describe("MÁXIMO 1 segmento de backfill running por conta (2ª micro-auditoria)", () => {
  function claimFn(): string {
    return active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
  }

  it("worker A claim segmento X -> worker B, mesma conta, outro segmento -> NÃO reivindica: existe um segundo exists(...) checando meta_backfill_segments running na MESMA conta, ainda sob o lock", () => {
    const fn = claimFn();
    const syncCheckIdx = fn.indexOf("from public.meta_sync_runs r");
    const secondCheckIdx = fn.indexOf(
      "from public.meta_backfill_segments s3",
      syncCheckIdx,
    );
    expect(secondCheckIdx, "segundo check (outro segmento running) não encontrado após o check de Current Sync").toBeGreaterThan(syncCheckIdx);

    const block = fn.slice(secondCheckIdx - 60, secondCheckIdx + 300);
    expect(block).toContain("join public.meta_backfill_jobs j3 on j3.id = s3.job_id");
    expect(block).toContain("j3.ad_account_ref = v_account_ref");
    expect(block).toContain("s3.status = 'running'");
    expect(block).toMatch(/if exists[\s\S]*then\s*\n?\s*return;/); // devolve, não lança
  });

  it("o segundo check acontece ANTES do UPDATE final que marca o candidato como running", () => {
    const fn = claimFn();
    const secondCheckIdx = fn.indexOf("from public.meta_backfill_segments s3");
    const finalUpdateIdx = fn.indexOf("update public.meta_backfill_segments s\n  set status = 'running'");
    expect(secondCheckIdx).toBeGreaterThan(-1);
    expect(finalUpdateIdx).toBeGreaterThan(secondCheckIdx);
  });

  it("contas diferentes continuam independentes: o check filtra por ad_account_ref = v_account_ref (por conta, não global)", () => {
    const fn = claimFn();
    const block = fn.slice(
      fn.indexOf("from public.meta_backfill_segments s3"),
      fn.indexOf("from public.meta_backfill_segments s3") + 300,
    );
    expect(block).toContain("j3.ad_account_ref = v_account_ref");
    expect(block).not.toContain("client_id");
  });

  it("lease EXPIRADA continua bloqueando o segundo segmento até recovery — check filtra só por status, NÃO por lease_expires_at", () => {
    const fn = claimFn();
    const block = fn.slice(
      fn.indexOf("from public.meta_backfill_segments s3"),
      fn.indexOf("from public.meta_backfill_segments s3") + 300,
    );
    expect(block).not.toContain("lease_expires_at");
  });
});

describe("invariante declarativo de ownership — CHECK constraint na tabela", () => {
  it("meta_backfill_segments_ownership_consistent: running exige os 3 campos preenchidos; qualquer outro status exige os 3 nulos", () => {
    const block = active.slice(
      active.indexOf("add constraint meta_backfill_segments_ownership_consistent"),
      active.indexOf("comment on constraint meta_backfill_segments_ownership_consistent"),
    );
    expect(block).toMatch(/status = 'running'\s*\n?\s*and claimed_at is not null\s*\n?\s*and lease_token is not null\s*\n?\s*and lease_expires_at is not null/);
    expect(block).toMatch(/status <> 'running'\s*\n?\s*and claimed_at is null\s*\n?\s*and lease_token is null\s*\n?\s*and lease_expires_at is null/);
  });
  it("é idempotente (do $$ ... exception when duplicate_object)", () => {
    const block = active.slice(
      active.indexOf("do $$ begin\n  alter table public.meta_backfill_segments\n    add constraint meta_backfill_segments_ownership_consistent"),
    );
    expect(block.slice(0, 500)).toContain("exception when duplicate_object then null");
  });
});

describe("4. contas diferentes não se bloqueiam", () => {
  it("a chave do lock é derivada POR CONTA (não por client_id, não global)", () => {
    const keyFn = active.slice(
      active.indexOf("function public.meta_backfill_account_lock_key"),
      active.indexOf("comment on function public.meta_backfill_account_lock_key"),
    );
    expect(keyFn).toContain("p_ad_account_ref");
    expect(keyFn).not.toContain("client_id");
  });
  it("meta_sync_acquire_client toma 1 lock POR CONTA elegível (loop), não 1 lock único do cliente", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("create or replace function public.claim_next_backfill_segment"),
    );
    expect(fn).toMatch(/for v_account in\s*\n?\s*select e\.ad_account_ref/);
    expect(fn).toContain("from public.meta_eligible_ad_accounts e");
  });
});

describe("ordem determinística evita deadlock entre chamadas concorrentes de acquire", () => {
  it("o loop de contas é ordenado por ad_account_ref", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("create or replace function public.claim_next_backfill_segment"),
    );
    expect(fn).toMatch(/where e\.client_id = p_client_id\s*\n?\s*order by e\.ad_account_ref/);
  });
});

describe("lock é de escopo de TRANSAÇÃO (xact) — nunca segurado além da aquisição", () => {
  it("usa pg_advisory_xact_lock (não pg_advisory_lock de sessão)", () => {
    expect(active).not.toMatch(/pg_advisory_lock\(/); // sem o "_xact_" seria de sessão — não deve existir
    expect(active).toContain("pg_advisory_xact_lock(");
  });
});

describe("15/16. guardas herdadas da V2.2.1 continuam presentes no novo corpo", () => {
  it("15. job terminal/paused/pending não fornece segmento — fase 1 exige j2.status = 'running'", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    expect(fn).toContain("j2.status = 'running'");
    expect(fn).not.toMatch(/j2\.status\s+in\s*\(/);
  });
  it("16. conta unlinked não executa — fase 1 exige a2.is_linked = true", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    expect(fn).toContain("a2.is_linked = true");
  });
});

describe("2. p_lease precisa ser um intervalo positivo", () => {
  it("claim_next_backfill_segment rejeita p_lease nulo/zero/negativo antes de escolher candidato", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    const beforeChoice = fn.slice(0, fn.indexOf("select s2.id, j2.ad_account_ref"));
    expect(beforeChoice).toMatch(/if p_lease is null or p_lease <= interval '0' then/);
    expect(beforeChoice).toContain("raise exception");
  });
});

describe("assinaturas preservadas — mesma interface pública", () => {
  it("meta_sync_acquire_client: mesmos 5 parâmetros e mesmo RETURNS TABLE", () => {
    const fn = active.slice(
      active.indexOf("create or replace function public.meta_sync_acquire_client"),
      active.indexOf("returns table", active.indexOf("meta_sync_acquire_client")),
    );
    expect(fn).toContain("p_client_id");
    expect(fn).toContain("p_trigger");
    expect(fn).toContain("p_date_from");
    expect(fn).toContain("p_date_to");
    expect(fn).toContain("p_created_by");
    const returnsBlock = active.slice(
      active.indexOf("returns table", active.indexOf("meta_sync_acquire_client")),
      active.indexOf("language plpgsql", active.indexOf("meta_sync_acquire_client")),
    );
    expect(returnsBlock).toContain("ad_account_ref");
    expect(returnsBlock).toContain("connection_id");
    expect(returnsBlock).toContain("run_id");
    expect(returnsBlock).toContain("sync_batch_id");
  });
  it("claim_next_backfill_segment: mesma assinatura e RETURNS TABLE de 20260910120000 (com lease_token)", () => {
    const fn = active.slice(active.indexOf("create or replace function public.claim_next_backfill_segment"));
    expect(fn).toContain("p_job_id uuid default null");
    expect(fn).toContain("p_lease  interval default interval '10 minutes'");
    expect(fn).toContain("lease_token    uuid");
  });
});

describe("nenhuma alteração fora do escopo desta migration", () => {
  it("não cria/dropa tabela alguma; o ÚNICO alter table é o CHECK de ownership (2ª micro-auditoria)", () => {
    expect(active).not.toMatch(/create table/);
    expect(active).not.toMatch(/drop table/);
    const alterHits = [...active.matchAll(/alter table/g)];
    expect(alterHits).toHaveLength(1);
    expect(active).toMatch(
      /alter table public\.meta_backfill_segments\s*\n?\s*add constraint meta_backfill_segments_ownership_consistent/,
    );
    // nenhuma coluna é adicionada/removida/tipo alterado — só o constraint.
    expect(active).not.toMatch(/alter table[\s\S]{0,80}(add column|drop column|alter column)/);
  });
  it("não toca meta_client_sync_health, Auto Sync dispatcher, Cron, meta_rate_budget", () => {
    expect(active).not.toMatch(/create (or replace )?view public\.meta_client_sync_health/);
    expect(active).not.toMatch(/create (or replace )?function public\.meta_clients_due_for_sync/);
    expect(active).not.toMatch(/create (or replace )?function public\.meta_sync_release/);
    expect(active).not.toContain("cron.schedule");
    expect(active).not.toContain("meta_rate_budget");
  });
  it("meta_sync_release NÃO é mencionado como alterado (Current Sync intocado além do acquire)", () => {
    expect(active).not.toContain("meta_sync_release");
  });
});
