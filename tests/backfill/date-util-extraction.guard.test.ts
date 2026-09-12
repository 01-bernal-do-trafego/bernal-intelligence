/**
 * DATA V2.3B — guarda da extração MÍNIMA de `_shared/date-util.ts` a partir
 * de `sync-core.ts`. Comportamento deve ser IDÊNTICO — só o lugar onde a
 * lógica vive mudou. Não roda contra Deno (parse-guard de texto).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const dateUtilSrc = read("../../supabase/functions/_shared/date-util.ts");
const syncCoreSrc = read("../../supabase/functions/_shared/sync-core.ts");

describe("date-util.ts contém exatamente a MESMA lógica que existia em sync-core.ts", () => {
  it("isoDate: mesma expressão (toISOString().slice(0, 10))", () => {
    expect(dateUtilSrc).toContain('d.toISOString().slice(0, 10)');
  });
  it("addDays: mesma construção (Date UTC + setUTCDate)", () => {
    expect(dateUtilSrc).toContain('new Date(`${base}T00:00:00Z`)');
    expect(dateUtilSrc).toContain("d.setUTCDate(d.getUTCDate() + n)");
  });
  it("accountToday: mesmo fallback UTC e mesmo uso de Intl.DateTimeFormat en-CA", () => {
    expect(dateUtilSrc).toContain('new Intl.DateTimeFormat("en-CA", { timeZone: tz })');
    expect(dateUtilSrc).toContain('const tz = timezoneName || "UTC"');
  });
});

describe("sync-core.ts não define mais isoDate/addDays/accountToday localmente — importa de date-util.ts", () => {
  it("importa { accountToday, addDays, isoDate } de ./date-util.ts", () => {
    expect(syncCoreSrc).toMatch(/import\s*\{\s*accountToday,\s*addDays,\s*isoDate\s*\}\s*from\s*["']\.\/date-util\.ts["']/);
  });
  it("não tem mais uma definição local de isoDate/addDays/accountToday", () => {
    expect(syncCoreSrc).not.toMatch(/const isoDate = \(d: Date\)/);
    expect(syncCoreSrc).not.toMatch(/const addDays = \(base: string/);
    expect(syncCoreSrc).not.toMatch(/function accountToday\(/);
  });
  it("ainda USA accountToday/addDays/isoDate normalmente (dailyHorizon, presetRange, runClientSync)", () => {
    expect(syncCoreSrc).toContain("accountToday(null)");
    expect(syncCoreSrc).toContain("accountToday(acc.timezone_name)");
    expect(syncCoreSrc).toMatch(/addDays\(today, -30\)/);
  });
});

describe("nenhuma outra mudança em sync-core.ts (Current Sync) — só a linha de import mudou de posição/lógica removida", () => {
  it("assinaturas públicas continuam intactas (runClientSync, RunClientSyncOpts, RunClientSyncResult)", () => {
    expect(syncCoreSrc).toContain("export async function runClientSync(");
    expect(syncCoreSrc).toContain("export interface RunClientSyncOpts");
    expect(syncCoreSrc).toContain("export interface RunClientSyncResult");
  });
  it("meta_sync_acquire_client/meta_sync_release/meta_sync_gc_stale continuam chamados exatamente como antes", () => {
    expect(syncCoreSrc).toContain('"meta_sync_acquire_client"');
    expect(syncCoreSrc).toContain('"meta_sync_release"');
    expect(syncCoreSrc).toContain('"meta_sync_gc_stale"');
  });
});
