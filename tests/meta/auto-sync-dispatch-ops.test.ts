/**
 * Parse-guards do arquivo OPERACIONAL supabase/ops/meta-auto-sync-dispatch.sql
 * (não é migration — (re)cria o job pg_cron do dispatcher).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../supabase/ops/meta-auto-sync-dispatch.sql", import.meta.url)),
  "utf8",
);
const lower = sql.toLowerCase();
const active = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const activeLower = active.toLowerCase();

describe("dispatcher ops — pg_net", () => {
  it("timeout_milliseconds = 140000 explícito (nunca o default)", () => {
    expect(active).toMatch(/timeout_milliseconds\s*:=\s*140000\b/);
    expect(active).not.toMatch(/timeout_milliseconds\s*:=\s*(2000|5000)\b/);
  });
  it("net.http_post é o transporte", () => {
    expect(activeLower).toContain("net.http_post");
  });
  it("target = /functions/v1/meta-sync-scheduled", () => {
    expect(active).toContain("/functions/v1/meta-sync-scheduled");
  });
});

describe("dispatcher ops — credenciais só do Vault", () => {
  it("URL vem de vault 'project_url'", () => {
    expect(active).toMatch(
      /url\s*:=\s*\(select\s+decrypted_secret\s+from\s+vault\.decrypted_secrets\s+where\s+name\s*=\s*'project_url'\)/i,
    );
  });
  it("apikey vem de vault 'publishable_key'", () => {
    expect(active).toMatch(
      /'apikey',\s*\(select\s+decrypted_secret\s+from\s+vault\.decrypted_secrets\s+where\s+name\s*=\s*'publishable_key'\)/i,
    );
  });
  it("x-meta-sync-cron-secret vem de vault 'meta_sync_cron_secret'", () => {
    expect(active).toMatch(
      /'x-meta-sync-cron-secret',\s*\(select\s+decrypted_secret\s+from\s+vault\.decrypted_secrets\s+where\s+name\s*=\s*'meta_sync_cron_secret'\)/i,
    );
  });
  it("NÃO usa service_role", () => {
    expect(activeLower).not.toContain("service_role");
  });
  it("nenhum secret literal (JWT / sb_ key / URL de projeto)", () => {
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(sql).not.toMatch(/sb_(publishable|secret)_[A-Za-z0-9]{6,}/);
    expect(sql).not.toMatch(/https:\/\/[a-z0-9]{6,}\.supabase\.co/i);
    expect(lower).not.toMatch(/bearer\s+ey/);
  });
});

describe("dispatcher ops — cadência / seleção", () => {
  it("schedule */15 * * * *", () => {
    expect(active).toMatch(/'meta-auto-sync-dispatch',\s*\n?\s*'\*\/15 \* \* \* \*'/);
  });
  it("seleção via meta_clients_due_for_sync(8, 4h, 4h)", () => {
    expect(active).toMatch(
      /meta_clients_due_for_sync\(\s*8,\s*interval\s+'4 hours',\s*interval\s+'4 hours'\s*\)/,
    );
  });
  it("1 POST por client_id retornado (from ... d)", () => {
    expect(activeLower).toMatch(/from\s+public\.meta_clients_due_for_sync\([^)]*\)\s+d\b/);
    expect(active).toMatch(/jsonb_build_object\(\s*'clientId',\s*d\.client_id::text\s*\)/);
  });
  it("idempotente: unschedule antes de schedule", () => {
    expect(activeLower).toMatch(/cron\.unschedule\(jobid\)\s+from\s+cron\.job\s+where\s+jobname\s*=\s*'meta-auto-sync-dispatch'/);
    expect(activeLower).toContain("cron.schedule(");
  });
});
