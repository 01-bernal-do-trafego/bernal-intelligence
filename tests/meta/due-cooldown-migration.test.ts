/**
 * Parse-guards da migration aditiva
 * 20260903213000_meta_due_retry_cooldown.sql
 *
 * Adiciona cooldown de retry ao dispatcher sem editar a migration já aplicada
 * 20260903193000_meta_auto_sync.sql e sem criar tabela nova.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), "utf8");

const sql = read("20260903213000_meta_due_retry_cooldown.sql");
const active = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("cooldown — nova assinatura", () => {
  it("adiciona parâmetro p_retry_cooldown com default 4h", () => {
    expect(active).toMatch(
      /p_retry_cooldown\s+interval\s+default\s+interval\s+'4 hours'/,
    );
  });
  it("DROP + CREATE da função (assinatura mudou) — 3 argumentos", () => {
    expect(active).toMatch(
      /drop\s+function\s+if\s+exists\s+public\.meta_clients_due_for_sync\(integer,\s*interval\)/,
    );
    expect(active).toMatch(
      /create\s+or\s+replace\s+function\s+public\.meta_clients_due_for_sync\(/,
    );
    expect(active).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.meta_clients_due_for_sync\(integer,\s*interval,\s*interval\)\s+to\s+service_role/,
    );
    expect(active).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.meta_clients_due_for_sync\(integer,\s*interval,\s*interval\)\s+from\s+public,\s*anon,\s*authenticated/,
    );
  });
});

describe("cooldown — predicado", () => {
  it("bloqueia re-seleção se houve meta_sync_runs do CLIENTE dentro do cooldown", () => {
    expect(active).toMatch(
      /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.meta_sync_runs\s+r\s+where\s+r\.client_id\s*=\s*e\.client_id\s+and\s+r\.started_at\s*>\s*now\(\)\s*-\s*p_retry_cooldown/,
    );
  });
  it("mantém a decisão por IDADE de performance_synced_at (não pelo status do run)", () => {
    expect(active).toContain("h.performance_synced_at is null");
    expect(active).toContain("now() - p_min_age");
    expect(active).not.toMatch(/h\.last_sync_status|r\.status\s*=\s*'error'/);
  });
  it("mantém o guard de 'running' < 20 min", () => {
    expect(active).toMatch(/r\.status\s*=\s*'running'/);
    expect(active).toContain("now() - interval '20 minutes'");
  });
  it("mantém DISTINCT por cliente e elegibilidade centralizada", () => {
    expect(active).toContain("distinct on (e.client_id)");
    expect(active).toContain("from public.meta_eligible_ad_accounts e");
  });
});

describe("cooldown — restrições de segurança / escopo", () => {
  it("SECURITY DEFINER + SET search_path = ''", () => {
    expect(active).toContain("security definer");
    expect(active).toMatch(/set\s+search_path\s*=\s*''/);
  });
  it("NÃO cria tabela nova", () => {
    expect(active).not.toMatch(/\bcreate\s+table\b/);
  });
  it("só cria índice de apoio em meta_sync_runs (idempotente)", () => {
    expect(active).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+meta_sync_runs_client_started_idx\s+on\s+public\.meta_sync_runs/,
    );
  });
  it("NÃO edita/dropa a migration anterior nem outras funções", () => {
    expect(active).not.toContain("meta_sync_acquire_client");
    expect(active).not.toContain("meta_eligible_ad_accounts\n"); // não recria a view
    const drops = active.match(/drop\s+function[^;]*/g) ?? [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain("meta_clients_due_for_sync(integer, interval)");
  });
  it("cron.schedule continua apenas COMENTADO", () => {
    for (const line of sql.split("\n")) {
      if (line.toLowerCase().includes("cron.schedule")) {
        expect(line.trim().startsWith("--")).toBe(true);
      }
    }
  });
  it("nenhum secret/JWT literal", () => {
    expect(sql.toLowerCase()).not.toMatch(/bearer\s+ey[a-z0-9]/i);
    expect(sql.toLowerCase()).toContain("vault.decrypted_secrets"); // só referência, comentada
  });
});

describe("template do cron.schedule (comentado) — apikey + Vault", () => {
  // só as linhas comentadas do bloco do cron
  const tpl = sql
    .split("\n")
    .filter((l) => l.trim().startsWith("--"))
    .join("\n");

  it("net.http_post continua só em linha comentada", () => {
    for (const line of sql.split("\n")) {
      if (line.toLowerCase().includes("net.http_post")) {
        expect(line.trim().startsWith("--")).toBe(true);
      }
    }
  });
  it("header apikey presente, lido de publishable_key no Vault", () => {
    expect(tpl).toMatch(/'apikey',\s*\(select\s+decrypted_secret\s+from\s+vault\.decrypted_secrets/i);
    expect(tpl).toMatch(/where\s+name\s*=\s*'publishable_key'/);
  });
  it("x-meta-sync-cron-secret presente, lido de meta_sync_cron_secret no Vault", () => {
    expect(tpl).toMatch(
      /'x-meta-sync-cron-secret',\s*\(select\s+decrypted_secret\s+from\s+vault\.decrypted_secrets/i,
    );
    expect(tpl).toMatch(/where\s+name\s*=\s*'meta_sync_cron_secret'/);
  });
  it("URL vem do Vault (project_url), sem host literal", () => {
    expect(tpl).toMatch(/where\s+name\s*=\s*'project_url'/);
    expect(tpl).toContain("/functions/v1/meta-sync-scheduled");
    // sem https://<algo>.supabase.co literal no arquivo
    expect(sql).not.toMatch(/https:\/\/[a-z0-9]{6,}\.supabase\.co/i);
  });
  it("apikey NÃO substitui o cron secret — os dois headers coexistem", () => {
    expect(tpl).toContain("'apikey'");
    expect(tpl).toContain("'x-meta-sync-cron-secret'");
  });
  it("nenhuma publishable/anon/service key literal no arquivo", () => {
    expect(sql).not.toMatch(/\b(eyJ[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9]{6,}|sb_secret_[A-Za-z0-9]{6,})\b/);
  });
  it("não há apikey com valor string literal (só via Vault)", () => {
    expect(tpl).not.toMatch(/'apikey'\s*,\s*'[^']+'/);
  });
});

describe("migration aplicada 20260903193000 permanece intacta", () => {
  it("continua com a assinatura de 2 argumentos", () => {
    const applied = read("20260903193000_meta_auto_sync.sql").toLowerCase();
    expect(applied).toMatch(
      /create\s+or\s+replace\s+function\s+public\.meta_clients_due_for_sync\(\s*p_limit\s+integer\s+default\s+8,\s*p_min_age\s+interval/,
    );
    expect(applied).not.toContain("p_retry_cooldown");
  });
});
