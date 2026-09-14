/**
 * META CONNECTION SECRET READ HARDENING — parse-guards estáticos.
 *
 * CAUSA RAIZ do bug real observado no Dev: leitores de `meta_connection_secrets`
 * descartavam `error` da consulta (`const { data: secret } = await admin...`).
 * Qualquer falha transitória de leitura (PostgREST/DB) resultava em
 * `data === null`, indistinguível de "linha ausente", e era tratada como
 * `no_connection_secret` — levando à marcação incorreta de
 * `reauthorization_required` numa conexão saudável.
 *
 * Estes testes provam, por leitor, que:
 *   1. a leitura passa por `readConnectionSecret` (_shared/connection-secret.ts)
 *      — nenhum `.from("meta_connection_secrets")...maybeSingle()` cru
 *      restante fora do próprio helper;
 *   2. `read_failed` NUNCA é tratado como `not_found`/`no_connection_secret`;
 *   3. `read_failed` NUNCA dispara `reauthorization_required` (Current Sync,
 *      Executor) nem os equivalentes de Discovery (no_history,
 *      connection_not_eligible) — só `decrypt_failed`/`not_found` fazem isso,
 *      exatamente como antes desta correção.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../supabase/functions/${p}`, import.meta.url)), "utf8");
const strip = (src: string) => src.slice(src.indexOf("*/") + 2);

const helper = read("_shared/connection-secret.ts");
const syncCore = read("_shared/sync-core.ts");
const adAccounts = read("meta-ad-accounts/index.ts");
const executor = read("meta-backfill-executor/index.ts");
const discovery = read("meta-backfill-discovery/index.ts");

describe("shared helper — readConnectionSecret (_shared/connection-secret.ts)", () => {
  it("distingue not_found (data:null, sem error) de read_failed (error != null) — nunca funde os dois", () => {
    expect(helper).toMatch(/if \(error\) \{[\s\S]{0,120}return \{ ok: false, kind: "read_failed"/);
    expect(helper).toMatch(/if \(!secret\) return \{ ok: false, kind: "not_found" \};/);
  });
  it("code, quando presente, é sanitizado (padrão SQLSTATE/PostgREST de 5 chars) — nunca a mensagem bruta", () => {
    expect(helper).toContain('/^[0-9A-Za-z]{5}$/');
    expect(helper).not.toMatch(/error\.message/);
  });
  it("nunca loga (sem console.* neste arquivo)", () => {
    expect(helper).not.toMatch(/console\./);
  });
});

for (const [name, srcRaw] of [
  ["sync-core.ts", syncCore],
  ["meta-ad-accounts/index.ts", adAccounts],
  ["meta-backfill-executor/index.ts", executor],
  ["meta-backfill-discovery/index.ts", discovery],
] as const) {
  describe(`${name} — usa o helper compartilhado, não reimplementa a leitura`, () => {
    const code = strip(srcRaw);
    it("importa readConnectionSecret de connection-secret.ts (helper compartilhado)", () => {
      expect(srcRaw).toMatch(/from ["'][^"']*connection-secret\.ts["']/);
      expect(srcRaw).toContain("readConnectionSecret(");
    });
    it("não consulta meta_connection_secrets diretamente (só o helper faz isso)", () => {
      expect(code).not.toContain('.from("meta_connection_secrets")');
    });
  });
}

describe("Current Sync (sync-core.ts) — comportamento por tipo de falha", () => {
  it("not_found -> no_connection_secret; read_failed -> connection_secret_read_failed (nunca o mesmo rótulo)", () => {
    expect(syncCore).toMatch(
      /tokenErr = secretResult\.kind === "not_found" \? "no_connection_secret" : "connection_secret_read_failed";/,
    );
  });
  it("só no_connection_secret e decrypt_failed disparam reauthorization_required — connection_secret_read_failed NÃO está nessa condição", () => {
    const line = syncCore.split("\n").find((l) => l.includes('reauthorization_required'))
      ? syncCore.split("\n").find((l) => l.includes('if (tokenErr === "no_connection_secret"'))
      : undefined;
    expect(line).toBeDefined();
    expect(line).not.toContain("connection_secret_read_failed");
  });
  it("run ainda vira erro (via meta_sync_release) em QUALQUER dos 3 casos — read_failed também interrompe a conta, só não marca a conexão", () => {
    const idx = syncCore.indexOf("if (tokenErr || !token || !acc)");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("meta-ad-accounts — comportamento HTTP por tipo de falha", () => {
  it("not_found -> 409 no_connection_secret", () => {
    expect(adAccounts).toMatch(
      /if \(secretResult\.kind === "not_found"\) return json\(\{ error: "no_connection_secret" \}, 409\);/,
    );
  });
  it("read_failed -> 5xx connection_secret_read_failed (não 409, não vira no_connection_secret)", () => {
    expect(adAccounts).toMatch(/return json\(\{ error: "connection_secret_read_failed" \}, 500\);/);
  });
});

describe("Backfill Executor — comportamento por tipo de falha (fencing/lease/locks inalterados)", () => {
  it("not_found mantém o comportamento atual: markReauthRequired + fail('unknown', 'no_connection_secret', ...)", () => {
    expect(executor).toMatch(
      /if \(secretResult\.kind === "not_found"\) \{[^\n]*\n\s*await markReauthRequired\("no_connection_secret"\);[^\n]*\n\s*return await fail\("unknown", "no_connection_secret", 0, 0\);/,
    );
  });
  it("read_failed NÃO chama markReauthRequired — só fail(...) recuperável", () => {
    const idx = executor.indexOf('return await fail("transient", "connection_secret_read_failed", 0, 0);');
    expect(idx).toBeGreaterThan(-1);
    const before = executor.slice(Math.max(0, idx - 400), idx);
    expect(before).not.toContain("markReauthRequired(");
  });
  it("fail_backfill_segment (RPC de fencing/lease) não foi tocado — só o kind/errorCode passados mudam", () => {
    expect(executor).toContain('const fail = async (kind: ErrorKind, errorCode: string, pagesFetched: number, rowsWritten: number) => {');
    expect(executor).toContain('await admin.rpc("fail_backfill_segment"');
  });
});

describe("Discovery — READ-ONLY preservado, comportamento por tipo de falha", () => {
  it("not_found -> 409 no_connection_secret (igual antes)", () => {
    expect(discovery).toMatch(
      /if \(secretResult\.kind === "not_found"\) return json\(\{ error: "no_connection_secret" \}, 409\);/,
    );
  });
  it("read_failed -> 5xx connection_secret_read_failed — as linhas de CÓDIGO (sem // comentários) do bloco não retornam no_history/connection_not_eligible", () => {
    const idx = discovery.indexOf("const secretResult = await readConnectionSecret(");
    const end = discovery.indexOf("let token: string;", idx);
    const block = discovery
      .slice(idx, end)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(block).toMatch(/return json\(\{ error: "connection_secret_read_failed" \}, 500\);/);
    expect(block).not.toContain("no_history");
    expect(block).not.toContain("connection_not_eligible");
    expect(block).not.toContain("reauthorization_required");
  });
  it("continua sem nenhum .update() em meta_connections em qualquer ramo do secret (READ-ONLY preservado)", () => {
    const code = strip(discovery);
    expect(code).not.toMatch(/\.from\("meta_connections"\)[\s\S]{0,80}\.update\(/);
  });
});

describe("regressão — nada mais no fluxo de secret mudou de forma não intencional", () => {
  it("Current Sync: decrypt_failed continua vindo só do catch de openToken (não do read)", () => {
    expect(syncCore).toMatch(/} catch \{\s*\n\s*tokenErr = "decrypt_failed";/);
  });
  it("Executor: decrypt_failed continua marcando reauth (comportamento pré-existente, intocado)", () => {
    expect(executor).toMatch(
      /await markReauthRequired\("decrypt_failed"\);[^\n]*\n\s*return await fail\("unknown", "decrypt_failed", 0, 0\);/,
    );
  });
  it("Discovery: decrypt_failed continua 409, sem nenhuma escrita (comportamento pré-existente, intocado)", () => {
    expect(discovery).toMatch(/return json\(\{ error: "decrypt_failed" \}, 409\);/);
  });
});
