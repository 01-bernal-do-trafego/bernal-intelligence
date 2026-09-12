/**
 * DATA V2.3B/V2.3B.1 — teste Deno REAL (confirmatório) das extensões em
 * `graph.ts` feitas para o Discovery (`GraphErrorDetails`,
 * `isRangeRejectedGraphError`). Prova que:
 *   1. a classificação de 5 valores (`classifyGraphError`/`GraphErrorKind`)
 *      — usada pelo Current Sync e pelo executor V2.2.3 — continua
 *      EXATAMENTE a mesma;
 *   2. `error.code === 100` sozinho NUNCA é suficiente para
 *      `isRangeRejectedGraphError` — precisa de evidência textual também.
 *
 * Rodar: `deno test supabase/functions/_shared/graph.test.ts`
 */
import { strictEqual } from "node:assert/strict";
import {
  classifyGraphError,
  extractGraphErrorDetails,
  GraphApiError,
  isRangeRejectedGraphError,
} from "./graph.ts";

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

Deno.test("GraphApiError.details — opcional, default vazio, NUNCA amplia .kind", () => {
  const withoutDetails = new GraphApiError("unknown");
  strictEqual(withoutDetails.details.code, null);
  strictEqual(withoutDetails.kind, "unknown");

  const withDetails = new GraphApiError("unknown", extractGraphErrorDetails({ error: { code: 100 } }));
  strictEqual(withDetails.details.code, 100);
  strictEqual(withDetails.kind, "unknown"); // .kind não muda — só .details carrega o dado extra.
});

Deno.test("extractGraphErrorDetails — extrai code/subcode/type/message/userTitle/userMessage", () => {
  const details = extractGraphErrorDetails({
    error: {
      code: 100,
      error_subcode: 12345,
      type: "OAuthException",
      message: "Invalid parameter",
      error_user_title: "Range too big",
      error_user_msg: "The requested time_range is too large",
    },
  });
  strictEqual(details.code, 100);
  strictEqual(details.subcode, 12345);
  strictEqual(details.type, "OAuthException");
  strictEqual(details.message, "Invalid parameter");
  strictEqual(details.userTitle, "Range too big");
  strictEqual(details.userMessage, "The requested time_range is too large");
});

Deno.test("extractGraphErrorDetails — body/error ausente ou malformado nunca lança, devolve tudo null", () => {
  const empty = { code: null, subcode: null, type: null, message: null, userTitle: null, userMessage: null };
  const cases = [null, undefined, {}, { error: null }, { error: "not an object" }, 42, "string"];
  for (const c of cases) {
    const d = extractGraphErrorDetails(c);
    strictEqual(JSON.stringify(d), JSON.stringify(empty));
  }
});

// ---------------------------------------------------------------------------
// isRangeRejectedGraphError — code 100 é NECESSÁRIO, NUNCA suficiente sozinho
// ---------------------------------------------------------------------------

Deno.test("code 100 + mensagem claramente de time_range/range -> range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(
      extractGraphErrorDetails({ error: { code: 100, message: "The time_range you requested is too large" } }),
    ),
    true,
  );
  strictEqual(
    isRangeRejectedGraphError(
      extractGraphErrorDetails({ error: { code: 100, error_user_msg: "Please select a smaller date range" } }),
    ),
    true,
  );
  strictEqual(
    isRangeRejectedGraphError(
      extractGraphErrorDetails({ error: { code: 100, error_user_title: "Invalid time range" } }),
    ),
    true,
  );
});

Deno.test("code 100 genérico (sem menção a range) -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 100, message: "Invalid parameter" } })),
    false,
  );
});

Deno.test("code 100 + parâmetro/field inválido -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(
      extractGraphErrorDetails({ error: { code: 100, message: "Unknown field: 'foo' on node type Ad" } }),
    ),
    false,
  );
});

Deno.test("code 100 + level inválido -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(
      extractGraphErrorDetails({ error: { code: 100, message: "level must be one of the following values: ad, adset, campaign, account" } }),
    ),
    false,
  );
});

Deno.test("code 100 sem message/subcode útil -> NÃO range_rejected (sem evidência = false)", () => {
  strictEqual(isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 100 } })), false);
  strictEqual(isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 100, message: "" } })), false);
});

Deno.test("auth (code 190) -> NÃO range_rejected mesmo com texto sobre range (code precisa ser 100)", () => {
  strictEqual(
    isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 190, message: "time_range invalid, token expired" } })),
    false,
  );
});

Deno.test("permission (code 10) -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 10, message: "date range access denied" } })),
    false,
  );
});

Deno.test("rate limit (code 4) -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 4, message: "User request limit reached for time_range queries" } })),
    false,
  );
});

Deno.test("5xx/transient (code 2) -> NÃO range_rejected", () => {
  strictEqual(
    isRangeRejectedGraphError(extractGraphErrorDetails({ error: { code: 2, message: "An unexpected error has occurred. Please retry your request later. time_range" } })),
    false,
  );
});

Deno.test("body nulo/vazio -> NÃO range_rejected", () => {
  strictEqual(isRangeRejectedGraphError(extractGraphErrorDetails(null)), false);
  strictEqual(isRangeRejectedGraphError(extractGraphErrorDetails({})), false);
});
