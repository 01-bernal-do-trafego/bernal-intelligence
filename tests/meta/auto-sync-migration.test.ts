/**
 * Parse-guards da migration 20260903193000_meta_auto_sync.sql.
 * Não roda contra o banco (sem harness) — protege as invariantes de segurança
 * e de arquitetura que só existem no SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260903193000_meta_auto_sync.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const lower = sql.toLowerCase();

/** linhas NÃO comentadas (fora de blocos `-- ` e `/* *​/`). */
function activeLines(): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const active = activeLines().toLowerCase();

describe("segurança da view meta_client_sync_health", () => {
  it("criada com security_invoker = true", () => {
    expect(active).toMatch(
      /create\s+or\s+replace\s+view\s+public\.meta_client_sync_health\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/,
    );
  });
  it("revoke de public/anon; grant SELECT só a authenticated/service_role", () => {
    expect(active).toMatch(
      /revoke\s+all\s+on\s+public\.meta_client_sync_health\s+from\s+public,\s*anon/,
    );
    expect(active).toMatch(
      /grant\s+select\s+on\s+public\.meta_client_sync_health\s+to\s+authenticated,\s*service_role/,
    );
    // nunca expõe a view a anon/public por grant
    expect(active).not.toMatch(
      /grant\s+select\s+on\s+public\.meta_client_sync_health\s+to\s+[^;]*\banon\b/,
    );
    expect(active).not.toMatch(
      /grant\s+select\s+on\s+public\.meta_client_sync_health\s+to\s+[^;]*\bpublic\b/,
    );
  });
});

describe("meta_sync_acquire_client", () => {
  it("NÃO recebe p_connection_id", () => {
    const sig = active.slice(
      active.indexOf("function public.meta_sync_acquire_client"),
      active.indexOf("returns table", active.indexOf("meta_sync_acquire_client")),
    );
    expect(sig).not.toContain("p_connection_id");
    expect(sig).toContain("p_client_id");
    expect(sig).toContain("p_trigger");
    expect(sig).toContain("p_created_by");
  });
  it("acquire é atômico via INSERT ... SELECT + rollback em unique_violation", () => {
    const body = active.slice(active.indexOf("function public.meta_sync_acquire_client"));
    expect(body).toMatch(/insert\s+into\s+public\.meta_sync_runs[\s\S]*?select[\s\S]*?from\s+public\.meta_eligible_ad_accounts/);
    expect(body).toMatch(/exception\s+when\s+unique_violation\s+then\s+raise\s+exception\s+'sync_already_running'/);
    expect(body).toContain("no_eligible_account");
    // um único batch id para todos os runs
    expect(body).toMatch(/v_batch\s+uuid\s*:=\s*(pg_catalog\.)?gen_random_uuid\(\)/);
  });
});

describe("elegibilidade centralizada (due == acquire)", () => {
  it("meta_eligible_ad_accounts é a fonte única, usada pelas duas funções", () => {
    expect(active).toContain("create or replace view public.meta_eligible_ad_accounts");
    const acquire = active.slice(active.indexOf("function public.meta_sync_acquire_client"), active.indexOf("function public.meta_client") > 0 ? active.indexOf("meta_essential_stages") : active.length);
    const due = active.slice(active.indexOf("function public.meta_clients_due_for_sync"));
    expect(acquire).toContain("public.meta_eligible_ad_accounts");
    expect(due).toContain("public.meta_eligible_ad_accounts");
  });
  it("elegibilidade cobre linkada + connection válida + has_secret, SEM tocar meta_connection_secrets", () => {
    const view = active.slice(
      active.indexOf("view public.meta_eligible_ad_accounts"),
      active.indexOf("revoke all on public.meta_eligible_ad_accounts"),
    );
    expect(view).toContain("a.is_linked = true");
    expect(view).toContain("a.connection_id is not null");
    expect(view).toMatch(/mc\.status\s+in\s*\(\s*'active',\s*'expiring'\s*\)/);
    expect(view).toContain("mc.has_secret = true");
    // NUNCA lê a tabela de segredos (deny-all p/ authenticated)
    expect(view).not.toContain("meta_connection_secrets");
  });
  it("meta_eligible_ad_accounts é security_invoker=true e legível por authenticated", () => {
    expect(active).toMatch(
      /create\s+or\s+replace\s+view\s+public\.meta_eligible_ad_accounts\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/,
    );
    expect(active).toMatch(
      /grant\s+select\s+on\s+public\.meta_eligible_ad_accounts\s+to\s+authenticated,\s*service_role/,
    );
    expect(active).toMatch(
      /revoke\s+all\s+on\s+public\.meta_eligible_ad_accounts\s+from\s+public,\s*anon/,
    );
  });
  it("a migration NUNCA lê a tabela meta_connection_secrets (from/join)", () => {
    // menção em `comment on ... is '...'` é documentação, ok; acesso real não.
    expect(active).not.toMatch(/\b(from|join)\s+public\.meta_connection_secrets\b/);
    expect(active).not.toMatch(/exists\s*\(\s*select[^)]*meta_connection_secrets/);
  });
  it("due decide por idade de performance_synced_at, não por status do run", () => {
    const due = active.slice(active.indexOf("function public.meta_clients_due_for_sync"));
    expect(due).toContain("performance_synced_at is null");
    expect(due).toContain("now() - p_min_age");
    expect(due).toContain("distinct on (e.client_id)"); // clientes DISTINTOS
  });
});

describe("view: edge cases de NULL e batch legado", () => {
  it("performance_synced_at NÃO usa min() cru — guard explícito de NULL", () => {
    const view = active.slice(
      active.indexOf("perf_per_client as ("),
      active.indexOf("runs_keyed as ("),
    );
    // precisa do bool_or/case antes do min
    expect(view).toMatch(/case[\s\S]*bool_or\(p\.perf_at is null\)[\s\S]*then null[\s\S]*else min\(p\.perf_at\)/);
  });

  it("runs LEGADOS (sync_batch_id NULL) usam coalesce(sync_batch_id, id) — não somem nem se fundem", () => {
    const view = active.slice(
      active.indexOf("runs_keyed as ("),
      active.indexOf("from perf_per_client pc"),
    );
    expect(view).toMatch(/coalesce\(r\.sync_batch_id,\s*r\.id\)\s+as\s+batch_key/);
    // last_batch NÃO filtra sync_batch_id is not null (senão legado desaparece)
    expect(view).not.toMatch(/where\s+r?\.?sync_batch_id\s+is\s+not\s+null/);
    expect(view).toContain("batch_key");
  });

  it("meta_auto_sync_enabled() lê o estado REAL do scheduler (cron.job), sem tabela nova", () => {
    expect(active).toContain("create or replace function public.meta_auto_sync_enabled()");
    const fn = active.slice(active.indexOf("function public.meta_auto_sync_enabled()"));
    expect(fn).toContain("from cron.job");
    expect(fn).toContain("jobname = 'meta-auto-sync-dispatch'");
    expect(fn).toMatch(/grant\s+execute\s+on\s+function\s+public\.meta_auto_sync_enabled\(\)\s+to\s+authenticated/);
    // nenhuma tabela/coluna nova só p/ o flag
    expect(active).not.toMatch(/create\s+table[\s\S]*auto_sync/i);
  });
});

describe("sync_batch_id + details_fetched_at", () => {
  it("adiciona meta_sync_runs.sync_batch_id", () => {
    expect(active).toMatch(
      /alter\s+table\s+public\.meta_sync_runs\s+add\s+column\s+if\s+not\s+exists\s+sync_batch_id\s+uuid/,
    );
  });
  it("adiciona meta_creatives.details_fetched_at SEM backfill heurístico", () => {
    expect(active).toMatch(
      /alter\s+table\s+public\.meta_creatives\s+add\s+column\s+if\s+not\s+exists\s+details_fetched_at\s+timestamptz/,
    );
    // nenhum UPDATE que preencha details_fetched_at por heurística
    expect(active).not.toMatch(/update\s+public\.meta_creatives[\s\S]*set[\s\S]*details_fetched_at/);
  });
});

describe("cron ainda NÃO ativado", () => {
  it("cron.schedule aparece apenas comentado", () => {
    expect(lower).toContain("cron.schedule");
    // toda ocorrência de cron.schedule está em linha comentada
    for (const line of sql.split("\n")) {
      if (line.toLowerCase().includes("cron.schedule")) {
        expect(line.trim().startsWith("--")).toBe(true);
      }
    }
  });
  it("secret vem do Vault, nunca literal no arquivo", () => {
    expect(lower).toContain("vault.decrypted_secrets");
    expect(lower).not.toMatch(/bearer\s+ey[a-z0-9]/i); // nenhum JWT/service key colado
  });
});

describe("extensões", () => {
  it("pg_cron / pg_net / supabase_vault", () => {
    expect(active).toContain("create extension if not exists pg_cron");
    expect(active).toContain("create extension if not exists pg_net");
    expect(active).toContain("create extension if not exists supabase_vault");
  });
});
