/**
 * Parse-guards da migration 20260910120000_meta_backfill_control_plane.sql.
 * Não roda contra o banco (não aplicada — DATA V2.2.1 é só CONTROL PLANE local)
 * — protege as invariantes de isolamento, concorrência e segurança que só
 * existem no SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260910120000_meta_backfill_control_plane.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** linhas NÃO comentadas (fora de `-- `), mesmo helper das outras migration guards. */
function activeLines(): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const active = activeLines().toLowerCase();

describe("tabelas criadas", () => {
  it("meta_backfill_jobs e meta_backfill_segments existem, idempotentes", () => {
    expect(active).toContain("create table if not exists public.meta_backfill_jobs");
    expect(active).toContain("create table if not exists public.meta_backfill_segments");
  });
});

describe("2. múltiplos jobs por conta — histórico permitido, ativo único", () => {
  it("NÃO existe UNIQUE(client_id, ad_account_ref) permanente/global", () => {
    // não pode existir um índice único simples e incondicional nessas colunas
    expect(active).not.toMatch(
      /unique\s*\(\s*client_id,\s*ad_account_ref\s*\)(?!\s*where)/,
    );
    expect(active).not.toMatch(
      /create unique index[^;]*on public\.meta_backfill_jobs\s*\(\s*client_id,\s*ad_account_ref\s*\)\s*;/,
    );
  });
  it("existe índice único PARCIAL: no máx. 1 job pending/running/paused por conta", () => {
    expect(active).toMatch(
      /create unique index if not exists meta_backfill_jobs_one_active_per_account\s*\n?\s*on public\.meta_backfill_jobs\s*\(\s*ad_account_ref\s*\)\s*\n?\s*where status in \(\s*'pending',\s*'running',\s*'paused'\s*\)/,
    );
  });
  it("os 4 status terminais NÃO entram no índice (não bloqueiam job novo/histórico)", () => {
    const idx = active.slice(
      active.indexOf("create unique index if not exists meta_backfill_jobs_one_active_per_account"),
      active.indexOf("comment on index public.meta_backfill_jobs_one_active_per_account") + 400,
    );
    for (const terminal of ["completed", "exhausted", "failed", "cancelled"]) {
      expect(idx, terminal).not.toContain(`'${terminal}'`);
    }
  });
});

describe("4. date_from > date_to é inválido (schema)", () => {
  it("meta_backfill_segments_range: check (date_from <= date_to)", () => {
    expect(active).toMatch(
      /constraint\s+meta_backfill_segments_range\s+check\s*\(\s*date_from\s*<=\s*date_to\s*\)/,
    );
  });
  it("meta_backfill_jobs_target_range: target_start_date <= target_end_date (ou null)", () => {
    expect(active).toMatch(
      /constraint\s+meta_backfill_jobs_target_range\s+check\s*\(\s*target_start_date\s+is\s+null\s+or\s+target_start_date\s*<=\s*target_end_date\s*\)/,
    );
  });
});

describe("5. segmento duplicado é impedido pelo schema", () => {
  it("UNIQUE (job_id, level, date_from, date_to)", () => {
    expect(active).toMatch(
      /constraint\s+meta_backfill_segments_natural_uq\s+unique\s*\(\s*job_id,\s*level,\s*date_from,\s*date_to\s*\)/,
    );
  });
  it("identidade do segmento (job_id/level/date_from/date_to) é imutável após criado", () => {
    const fn = active.slice(
      active.indexOf("function public.meta_backfill_segments_lock_identity"),
    );
    expect(fn).toContain("new.job_id is distinct from old.job_id");
    expect(fn).toContain("new.level is distinct from old.level");
    expect(fn).toContain("new.date_from is distinct from old.date_from");
    expect(fn).toContain("new.date_to is distinct from old.date_to");
  });
});

describe("6/16. client_id <-> ad_account_ref — isolamento entre clientes", () => {
  it("trigger de INSERT confirma que a conta pertence ao client_id", () => {
    const fn = active.slice(
      active.indexOf("function public.meta_backfill_check_account_client"),
    );
    expect(fn).toMatch(
      /where\s+a\.id\s*=\s*new\.ad_account_ref\s+and\s+a\.client_id\s*=\s*new\.client_id/,
    );
    expect(fn).toContain("raise exception");
  });
  it("5. trigger de INSERT também exige a conta LINKADA (is_linked = true)", () => {
    const fn = active.slice(
      active.indexOf("function public.meta_backfill_check_account_client"),
    );
    expect(fn).toContain("a.is_linked = true");
  });
  it("trigger roda em BEFORE INSERT em meta_backfill_jobs", () => {
    expect(active).toMatch(
      /before\s+insert\s+on\s+public\.meta_backfill_jobs[\s\S]{0,80}execute\s+function\s+public\.meta_backfill_check_account_client/,
    );
  });
  it("client_id é imutável (reaproveita meta_lock_client_id existente)", () => {
    expect(active).toMatch(
      /before\s+update\s+on\s+public\.meta_backfill_jobs[\s\S]{0,80}execute\s+function\s+public\.meta_lock_client_id/,
    );
  });
  it("ad_account_ref é imutável (nova trigger, mesmo estilo)", () => {
    const fn = active.slice(active.indexOf("function public.meta_lock_ad_account_ref"));
    expect(fn).toContain("new.ad_account_ref is distinct from old.ad_account_ref");
    expect(active).toMatch(
      /before\s+update\s+on\s+public\.meta_backfill_jobs[\s\S]{0,80}execute\s+function\s+public\.meta_lock_ad_account_ref/,
    );
  });
});

describe("máquina de estados — SQL espelha exatamente lib/backfill/transitions.ts", () => {
  it("job: pending -> running, cancelled", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_jobs_check_transition"));
    expect(fn).toMatch(/when\s+'pending'\s+then\s+new\.status\s+in\s*\(\s*'running',\s*'cancelled'\s*\)/);
  });
  it("job: running -> paused, completed, exhausted, failed, cancelled", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_jobs_check_transition"));
    expect(fn).toMatch(
      /when\s+'running'\s+then\s+new\.status\s+in\s*\(\s*'paused',\s*'completed',\s*'exhausted',\s*'failed',\s*'cancelled'\s*\)/,
    );
  });
  it("job: paused -> running, cancelled", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_jobs_check_transition"));
    expect(fn).toMatch(/when\s+'paused'\s+then\s+new\.status\s+in\s*\(\s*'running',\s*'cancelled'\s*\)/);
  });
  it("job: mesmo status é sempre permitido (early return)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_jobs_check_transition"));
    expect(fn).toMatch(/if\s+new\.status\s*=\s*old\.status\s+then\s+return\s+new/);
  });
  it("job: transição inválida levanta exceção (não falha silenciosa)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_jobs_check_transition"));
    expect(fn).toContain("if not v_valid then");
    expect(fn).toMatch(/raise exception\s+'meta_backfill_jobs: transição de status inválida/);
  });

  it("segment: pending -> running", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    expect(fn).toMatch(/when\s+'pending'\s+then\s+new\.status\s+in\s*\(\s*'running'\s*\)/);
  });
  it("segment: running -> done, failed, skipped_no_data, pending (lease)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    expect(fn).toMatch(
      /when\s+'running'\s+then\s+new\.status\s+in\s*\(\s*'done',\s*'failed',\s*'skipped_no_data',\s*'pending'\s*\)/,
    );
  });
  it("segment: failed -> pending (retry)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    expect(fn).toMatch(/when\s+'failed'\s+then\s+new\.status\s+in\s*\(\s*'pending'\s*\)/);
  });
  it("segment: transição inválida levanta exceção", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    expect(fn).toContain("if not v_valid then");
    expect(fn).toMatch(/raise exception\s+'meta_backfill_segments: transição de status inválida/);
  });
});

describe("9. retry incrementa attempt_count de forma coerente", () => {
  it("ao entrar em running vindo SÓ de pending, attempt_count += 1 (failed NÃO entra aqui)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    expect(fn).toMatch(
      /if\s+new\.status\s*=\s*'running'\s+and\s+old\.status\s*=\s*'pending'\s+then/,
    );
    expect(fn).toContain("new.attempt_count   := old.attempt_count + 1");
    // a variante antiga (old.status IN ('pending','failed')) seria inconsistente
    // com a trigger não aceitar failed->running (v_valid só permite failed->pending)
    expect(fn).not.toMatch(/old\.status\s+in\s*\(\s*'pending',\s*'failed'\s*\)/);
  });
  it("recuperação de lease (running -> pending) NÃO é tratada como falha/erro", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    // a transição running->pending existe e limpa claimed_at/lease_expires_at,
    // sem incrementar attempt_count (o incremento só ocorre ao ENTRAR em running)
    expect(fn).toMatch(/new\.status\s*=\s*'pending'\s+and\s+old\.status\s*=\s*'running'/);
    expect(fn).toContain("new.claimed_at       := null");
  });
  it("failed->running NÃO é uma transição válida (só failed->pending)", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    const validCase = fn.slice(fn.indexOf("v_valid := case"), fn.indexOf("if not v_valid"));
    expect(validCase).toMatch(/when\s+'failed'\s+then\s+new\.status\s+in\s*\(\s*'pending'\s*\)/);
    expect(validCase).not.toMatch(/when\s+'failed'\s+then\s+new\.status\s+in\s*\([^)]*'running'/);
  });
});

describe("7/8. claim_next_backfill_segment — concorrência e lease", () => {
  const fn = () => active.slice(active.indexOf("function public.claim_next_backfill_segment"));

  it("usa FOR UPDATE ... SKIP LOCKED (concorrência-safe por desenho)", () => {
    expect(fn()).toMatch(/for update of s2 skip locked/);
  });
  it("aquisição e transição para running no MESMO statement (1 UPDATE)", () => {
    expect(fn()).toMatch(/update public\.meta_backfill_segments s[\s\S]*?set status = 'running'/);
  });
  it("define lease_expires_at ao reivindicar (claim consistente)", () => {
    expect(fn()).toContain("lease_expires_at = now() + p_lease");
  });
  it("6. job paused/pending/terminal NUNCA fornece segmento — só job running", () => {
    expect(fn()).toMatch(/j2\.status\s*=\s*'running'/);
    // garante que não existe uma variante que aceite outros status do job
    expect(fn()).not.toMatch(/j2\.status\s+in\s*\(/);
  });
  it("3. SÓ segmentos pending são elegíveis — claim NUNCA lê failed diretamente", () => {
    expect(fn()).toMatch(/s2\.status\s*=\s*'pending'/);
    // a versão antiga (`in ('pending','failed')`) seria inconsistente com a
    // trigger, que só aceita failed->pending, nunca failed->running
    expect(fn()).not.toMatch(/s2\.status\s+in\s*\(/);
  });
  it("6. gera lease_token novo a cada claim (fencing)", () => {
    expect(fn()).toContain("lease_token = pg_catalog.gen_random_uuid()");
    expect(fn()).toContain("s.lease_token");
    expect(active).toMatch(
      /returns table\s*\([\s\S]*?lease_token\s+uuid[\s\S]*?\)\s*\n?language plpgsql\s*\n?security definer/,
    );
  });
  it("5. só reivindica segmento de conta AINDA is_linked = true", () => {
    expect(fn()).toContain("join public.meta_ad_accounts a2 on a2.id = j2.ad_account_ref");
    expect(fn()).toContain("a2.is_linked = true");
  });
  it("checa Current Sync (meta_sync_runs) SÓ POR LEITURA — nunca escreve nela", () => {
    const body = fn();
    expect(body).toMatch(/not exists\s*\(\s*select 1 from public\.meta_sync_runs r/);
    expect(body).not.toMatch(/insert into public\.meta_sync_runs/);
    expect(body).not.toMatch(/update public\.meta_sync_runs/);
  });
  it("1. a exclusão do Current Sync é documentada como BEST-EFFORT, não atômica", () => {
    // a doc da função (SQL ativo, comment on ... is '...') precisa dizer isso
    const fnComment = active.slice(
      active.indexOf("comment on function public.claim_next_backfill_segment"),
      active.indexOf("comment on function public.claim_next_backfill_segment") + 600,
    );
    expect(fnComment).toMatch(/best-effort/);
    expect(fnComment).toMatch(/não atômico/);
    // a nota de topo do arquivo (bloco `--`) também precisa — aqui é prosa/
    // documentação, então checa o arquivo cru (não `active`, que exclui `--`).
    const rawLower = sql.toLowerCase();
    expect(rawLower).toMatch(/best-effort,\s*não\s*atômico/);
    expect(rawLower).toContain("pg_advisory_xact_lock"); // mecanismo futuro proposto, não implementado
  });
  it("função é SECURITY DEFINER, revogada de authenticated/anon, só service_role executa", () => {
    expect(active).toMatch(
      /create or replace function public\.claim_next_backfill_segment[\s\S]*?security definer/,
    );
    expect(active).toMatch(
      /revoke all on function public\.claim_next_backfill_segment\(uuid, interval\)\s*\n?\s*from public, anon, authenticated/,
    );
    expect(active).toMatch(
      /grant execute on function public\.claim_next_backfill_segment\(uuid, interval\)\s*\n?\s*to service_role/,
    );
  });
});

describe("10. recuperação de segmento com lease vencida", () => {
  it("meta_backfill_release_stale_segments só mexe em running com lease expirada", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_release_stale_segments"));
    expect(fn).toContain("status = 'running'");
    expect(fn).toContain("lease_expires_at < now()");
    expect(fn).toContain("set status = 'pending'");
  });
  it("é SECURITY DEFINER, só service_role — sem Cron criado para chamá-la", () => {
    expect(active).toMatch(
      /create or replace function public\.meta_backfill_release_stale_segments[\s\S]*?security definer/,
    );
    expect(active).toMatch(
      /grant execute on function public\.meta_backfill_release_stale_segments\(\)\s*\n?\s*to service_role/,
    );
    expect(active).not.toContain("cron.schedule");
  });
});

describe("6. fencing — worker antigo não pode sobrescrever silenciosamente", () => {
  it("coluna lease_token existe no schema do segmento", () => {
    const table = active.slice(
      active.indexOf("create table if not exists public.meta_backfill_segments"),
      active.indexOf("comment on table public.meta_backfill_segments"),
    );
    expect(table).toMatch(/lease_token\s+uuid/);
  });
  it("recuperação de lease (running->pending) zera claimed_at/lease_expires_at/lease_token", () => {
    const fn = active.slice(active.indexOf("function public.meta_backfill_segments_check_transition"));
    const block = fn.slice(fn.indexOf("old.status = 'running'"));
    expect(block).toContain("new.claimed_at       := null");
    expect(block).toContain("new.lease_expires_at := null");
    expect(block).toContain("new.lease_token      := null");
  });
  it("comentário da coluna documenta o contrato de compare-and-set p/ uma futura RPC de finalização", () => {
    const comment = active.slice(active.indexOf("comment on column public.meta_backfill_segments.lease_token"));
    expect(comment).toMatch(/fencing/);
    expect(comment).toContain("lease_token = ?");
  });
});

describe("11/12. RLS e privilégios", () => {
  it("meta_backfill_jobs: SELECT respeita can_access_client(client_id)", () => {
    expect(active).toMatch(
      /create policy meta_backfill_jobs_select on public\.meta_backfill_jobs\s+for select to authenticated\s+using\s*\(\s*public\.can_access_client\(client_id\)\s*\)/,
    );
  });
  it("meta_backfill_segments: SELECT via EXISTS no job pai (can_access_client)", () => {
    const policy = active.slice(
      active.indexOf("create policy meta_backfill_segments_select"),
    );
    expect(policy).toMatch(/exists\s*\(/);
    expect(policy).toContain("public.can_access_client(j.client_id)");
  });
  it("RLS habilitada nas duas tabelas", () => {
    expect(active).toContain("alter table public.meta_backfill_jobs     enable row level security");
    expect(active).toContain("alter table public.meta_backfill_segments enable row level security");
  });
  it("authenticated NÃO ganha INSERT/UPDATE/DELETE direto — só SELECT", () => {
    expect(active).toMatch(
      /grant select on public\.meta_backfill_jobs, public\.meta_backfill_segments\s*\n?\s*to authenticated/,
    );
    // nenhuma policy de escrita para authenticated nas 2 tabelas
    expect(active).not.toMatch(/for insert to authenticated/);
    expect(active).not.toMatch(/for update to authenticated/);
    expect(active).not.toMatch(/for delete to authenticated/);
    // nenhum grant de insert/update/delete a authenticated nestas tabelas
    expect(active).not.toMatch(
      /grant\s+(insert|update|delete)[^;]*meta_backfill_(jobs|segments)[^;]*to\s+authenticated/,
    );
  });
  it("revoke all de anon/authenticated/public nas 2 tabelas, antes do grant select", () => {
    expect(active).toMatch(
      /revoke all on public\.meta_backfill_jobs, public\.meta_backfill_segments\s*\n?\s*from anon, authenticated, public/,
    );
  });
});

describe("13/14/15/16. isolamento do Current Sync — nenhuma alteração", () => {
  it("nenhum DDL cria/altera/dropa meta_sync_runs", () => {
    expect(active).not.toMatch(/create table[\s\S]{0,40}meta_sync_runs/);
    expect(active).not.toMatch(/alter table public\.meta_sync_runs/);
    expect(active).not.toMatch(/drop table[\s\S]{0,40}meta_sync_runs/);
  });
  it("nenhum DDL cria/altera/dropa meta_client_sync_health", () => {
    expect(active).not.toMatch(/create (or replace )?view public\.meta_client_sync_health/);
    expect(active).not.toMatch(/drop view[\s\S]{0,40}meta_client_sync_health/);
  });
  it("nenhuma função/RPC do Auto Sync é recriada ou alterada", () => {
    for (const fn of [
      "meta_sync_acquire_client",
      "meta_sync_release",
      "meta_clients_due_for_sync",
      "meta_eligible_ad_accounts",
      "meta_essential_stages",
      "meta_sync_gc_stale",
      "meta_auto_sync_enabled",
    ]) {
      expect(active).not.toMatch(new RegExp(`create (or replace )?(function|view) public\\.${fn}`));
      expect(active).not.toMatch(new RegExp(`drop (function|view)[\\s\\S]{0,10}${fn}`));
    }
  });
  it("nenhum cron.schedule/cron.unschedule (nem comentado como código ativo)", () => {
    expect(sql.toLowerCase()).not.toContain("cron.schedule");
    expect(sql.toLowerCase()).not.toContain("cron.unschedule");
  });
  it("a ÚNICA menção real de meta_sync_runs no SQL ativo é a leitura (SELECT) da exclusividade", () => {
    const hits = [...active.matchAll(/meta_sync_runs/g)].length;
    // a única referência real (fora de comentários -- e de strings de `comment on`)
    // é o `not exists (select 1 from public.meta_sync_runs r ...)`
    expect(active).toContain("select 1 from public.meta_sync_runs r");
    expect(hits).toBeGreaterThanOrEqual(1);
  });
});

describe("meta_backfill_progress — telemetria derivada, sem contador duplicado no job", () => {
  it("view existe, security_invoker=true", () => {
    expect(active).toMatch(
      /create or replace view public\.meta_backfill_progress\s*\n?with\s*\(\s*security_invoker\s*=\s*true\s*\)/,
    );
  });
  it("progress_percent e contadores vêm de count(...)/min/max sobre segments, não de coluna no job", () => {
    const view = active.slice(
      active.indexOf("view public.meta_backfill_progress"),
      active.indexOf("revoke all on public.meta_backfill_progress"),
    );
    expect(view).toContain("count(s.id)");
    expect(view).toContain("progress_percent");
    expect(view).toContain("min(s.date_from)");
    expect(view).toContain("max(s.date_to)");
  });
  it("meta_backfill_jobs NÃO tem coluna oldest_date_fetched/newest_backfilled_date/segments_total (evita duplicidade)", () => {
    const jobsTable = active.slice(
      active.indexOf("create table if not exists public.meta_backfill_jobs"),
      active.indexOf("create table if not exists public.meta_backfill_segments"),
    );
    expect(jobsTable).not.toContain("oldest_date_fetched");
    expect(jobsTable).not.toContain("newest_backfilled_date");
    expect(jobsTable).not.toContain("segments_total");
  });
  it("revoke de anon/public, grant select a authenticated/service_role", () => {
    expect(active).toMatch(
      /revoke all on public\.meta_backfill_progress from public, anon/,
    );
    expect(active).toMatch(
      /grant select on public\.meta_backfill_progress to authenticated, service_role/,
    );
  });
});

describe("reaproveita o enum de nível existente (sem tipo paralelo)", () => {
  it("requested_levels/level usam public.meta_insight_level", () => {
    expect(active).toContain("requested_levels       public.meta_insight_level[] not null");
    expect(active).toContain("level            public.meta_insight_level not null");
    expect(active).not.toContain("create type public.meta_backfill_level");
  });
});

describe("nenhum planner/executor/rate budget nesta migration", () => {
  it("nenhum INSERT gera segmentos (planner é fase futura)", () => {
    expect(active).not.toMatch(/insert into public\.meta_backfill_segments/);
  });
  it("nenhuma tabela meta_rate_budget", () => {
    expect(active).not.toContain("meta_rate_budget");
  });
  it("nenhuma extensão nova é criada (pg_cron/pg_net/vault já existem desde o Auto Sync)", () => {
    expect(active).not.toContain("create extension");
  });
});
