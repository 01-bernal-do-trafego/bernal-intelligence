/**
 * Diagnóstico SANITIZADO da falha de troca do `code` da Meta por access token.
 * Módulo PURO.
 *
 * A Edge Function `meta-oauth-exchange` tem a sua própria cópia mínima disto
 * (fronteira Deno). Esta versão existe para ser testada isoladamente e para
 * documentar o contrato do que PODE aparecer no log.
 *
 * O que PODE ir para o log (quando a Meta devolver):
 *   - meta_http_status  (status HTTP da resposta da Meta)
 *   - meta_error_type   (error.type)
 *   - meta_error_code   (error.code)
 *   - meta_error_subcode(error.error_subcode)
 *   - meta_message      (error.message já sanitizada — truncada, sem tokens)
 *   - non_json          (true quando a resposta da Meta não era JSON)
 *
 * O que NUNCA entra: authorization code, access token, client secret,
 * META_APP_SECRET, META_TOKEN_ENC_KEY, JWT, header Authorization, corpo cru da
 * requisição/resposta.
 */

/** Sequência longa de caracteres "de token" — redigida por precaução. */
const TOKENISH = /[A-Za-z0-9_-]{20,}/g;

/** Tamanho máximo da mensagem sanitizada. */
export const SANITIZED_MESSAGE_MAX = 200;

/**
 * Sanitiza uma mensagem de erro vinda da Meta: colapsa espaços, redige
 * qualquer sequência longa parecida com token/segredo e trunca.
 */
export function sanitizeMetaMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(TOKENISH, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SANITIZED_MESSAGE_MAX);
}

export interface SanitizedExchangeError {
  meta_http_status: number;
  meta_error_type: string | null;
  meta_error_code: number | null;
  meta_error_subcode: number | null;
  meta_message: string | null;
  non_json: boolean;
}

/**
 * Monta o diagnóstico sanitizado a partir do status HTTP e do corpo já
 * parseado (ou `null` se a resposta não era JSON). Só lê `body.error.*`.
 */
export function buildSanitizedExchangeError(input: {
  httpStatus: number;
  body: unknown;
}): SanitizedExchangeError {
  const { httpStatus, body } = input;

  if (body == null || typeof body !== "object") {
    return {
      meta_http_status: httpStatus,
      meta_error_type: null,
      meta_error_code: null,
      meta_error_subcode: null,
      meta_message: null,
      non_json: true,
    };
  }

  const err = (body as Record<string, unknown>).error;
  const e =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;

  const message = e ? sanitizeMetaMessage(e.message) : "";

  return {
    meta_http_status: httpStatus,
    meta_error_type: e && typeof e.type === "string" ? e.type : null,
    meta_error_code: e && typeof e.code === "number" ? e.code : null,
    meta_error_subcode:
      e && typeof e.error_subcode === "number" ? e.error_subcode : null,
    meta_message: message.length > 0 ? message : null,
    non_json: false,
  };
}
