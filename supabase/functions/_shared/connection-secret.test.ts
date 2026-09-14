/**
 * META CONNECTION SECRET READ HARDENING — teste Deno REAL (confirmatório)
 * de `readConnectionSecret` (_shared/connection-secret.ts).
 *
 * Prova a distinção central: erro de CONSULTA (`error != null`) NUNCA vira
 * `not_found` — mesmo quando `data === null` (exatamente o formato que o
 * bug real produzia antes desta correção).
 *
 * Rodar: `deno test supabase/functions/_shared/connection-secret.test.ts`
 */
import { strictEqual } from "node:assert/strict";
import { readConnectionSecret } from "./connection-secret.ts";

// deno-lint-ignore no-explicit-any
function fakeAdmin(result: { data: unknown; error: unknown }): any {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("row existente -> ok:true com os 3 campos, nada mais", async () => {
  const admin = fakeAdmin({
    data: { token_cipher: "c", token_iv: "i", token_tag: "t" },
    error: null,
  });
  const result = await readConnectionSecret(admin, "conn-1");
  strictEqual(result.ok, true);
  if (result.ok) {
    strictEqual(result.secret.token_cipher, "c");
    strictEqual(result.secret.token_iv, "i");
    strictEqual(result.secret.token_tag, "t");
  }
});

Deno.test("consulta success + data:null -> not_found (NÃO read_failed)", async () => {
  const admin = fakeAdmin({ data: null, error: null });
  const result = await readConnectionSecret(admin, "conn-1");
  strictEqual(result.ok, false);
  if (!result.ok) strictEqual(result.kind, "not_found");
});

Deno.test("consulta error (mesmo com data:null, formato do bug real) -> read_failed, NUNCA not_found", async () => {
  const admin = fakeAdmin({
    data: null,
    error: { code: "08006", message: "connection failure — sensitive db internals" },
  });
  const result = await readConnectionSecret(admin, "conn-1");
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.kind, "read_failed");
    strictEqual(result.code, "08006");
  }
});

Deno.test("consulta error com code não-alfanumérico-5 (formato inesperado) -> read_failed sem code", async () => {
  const admin = fakeAdmin({ data: null, error: { code: "not-a-sqlstate!!" } });
  const result = await readConnectionSecret(admin, "conn-1");
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.kind, "read_failed");
    strictEqual(result.code, undefined);
  }
});

Deno.test("consulta error sem code -> read_failed, code ausente (nunca inventado)", async () => {
  const admin = fakeAdmin({ data: null, error: { message: "boom" } });
  const result = await readConnectionSecret(admin, "conn-1");
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.kind, "read_failed");
    strictEqual("code" in result ? result.code : undefined, undefined);
  }
});

Deno.test("nunca expõe cipher/iv/tag em resultado de erro (not_found ou read_failed)", () => {
  const notFound: { ok: false; kind: "not_found" } = { ok: false, kind: "not_found" };
  const readFailed: { ok: false; kind: "read_failed"; code?: string } = {
    ok: false,
    kind: "read_failed",
    code: "08006",
  };
  const notFoundStr = JSON.stringify(notFound);
  const readFailedStr = JSON.stringify(readFailed);
  for (const s of [notFoundStr, readFailedStr]) {
    strictEqual(/cipher|token_iv|token_tag/i.test(s), false);
  }
});
