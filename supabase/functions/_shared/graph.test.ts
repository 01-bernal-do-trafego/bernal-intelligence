/**
 * DATA V2.3B — teste Deno REAL (confirmatório) da extensão em `graph.ts`
 * feita para o Discovery (`GraphApiError.code`, opcional). Prova que a
 * classificação de 5 valores (`classifyGraphError`/`GraphErrorKind`) — usada
 * pelo Current Sync e pelo executor V2.2.3 — continua EXATAMENTE a mesma;
 * `code` é um campo NOVO e opcional, nunca lido por quem só usa `.kind`.
 *
 * Rodar: `deno test supabase/functions/_shared/graph.test.ts`
 */
import { strictEqual } from "node:assert/strict";
import { classifyGraphError, GraphApiError } from "./graph.ts";

Deno.test("classifyGraphError — as 5 categorias existentes continuam intactas", () => {
  strictEqual(classifyGraphError({ error: { code: 190 } }), "token_revoked");
  strictEqual(classifyGraphError({ error: { code: 102, error_subcode: 463 } }), "token_revoked");
  strictEqual(classifyGraphError({ error: { code: 10 } }), "insufficient_permission");
  strictEqual(classifyGraphError({ error: { code: 4 } }), "rate_limited");
  strictEqual(classifyGraphError({ error: { code: 1 } }), "transient");
  strictEqual(classifyGraphError(null), "unknown");
  strictEqual(classifyGraphError({}), "unknown");
});

Deno.test("classifyGraphError — code 100 (Invalid parameter) continua classificado como 'unknown' — SEM 6ª categoria em GraphErrorKind", () => {
  strictEqual(classifyGraphError({ error: { code: 100 } }), "unknown");
});

Deno.test("GraphApiError.code — opcional, default null, NUNCA amplia .kind", () => {
  const withoutCode = new GraphApiError("unknown");
  strictEqual(withoutCode.code, null);
  strictEqual(withoutCode.kind, "unknown");

  const withCode = new GraphApiError("unknown", 100);
  strictEqual(withCode.code, 100);
  strictEqual(withCode.kind, "unknown"); // .kind não muda — só .code carrega o dado extra.
});
