/**
 * Mensagens de erro do fluxo OAuth da Meta, em PT-BR, para exibir ao usuário.
 * Módulo PURO.
 *
 * Duas fontes de erro:
 *   1. Meta devolve `?error=...&error_reason=...&error_description=...` no callback
 *      (ex.: usuário cancelou).
 *   2. Falhas internas nossas (state inválido, sem code, troca falhou...), que
 *      viram `?meta=error&reason=<code>` no redirect de volta ao dashboard.
 */

export type MetaCallbackReason =
  | "denied" // usuário recusou / erro vindo da Meta
  | "state" // state ausente, adulterado, expirado ou divergente
  | "nocode" // callback sem `code` e sem `error`
  | "session" // sessão do usuário sumiu no meio do fluxo
  | "not_configured" // variáveis do app Meta ausentes no ambiente
  | "client_not_found" // cliente inexistente ou fora do acesso do usuário
  | "exchange" // Edge Function indisponível ou recusou a troca
  | "unknown";

const CALLBACK_MESSAGE: Record<MetaCallbackReason, string> = {
  denied: "A autorização no Facebook foi cancelada. Nenhuma conexão foi criada.",
  state:
    "A verificação de segurança do retorno falhou (state inválido ou expirado). Tente conectar novamente.",
  nocode: "O Facebook não devolveu o código de autorização. Tente novamente.",
  session: "Sua sessão expirou durante a conexão. Entre novamente e repita.",
  not_configured:
    "A integração com a Meta ainda não está configurada neste ambiente.",
  client_not_found: "Cliente não encontrado ou sem permissão de acesso.",
  exchange:
    "Não foi possível concluir a troca segura do token. Verifique se a função de conexão foi publicada e tente novamente.",
  unknown: "Não foi possível concluir a conexão com a Meta. Tente novamente.",
};

export function parseCallbackReason(value: string | null | undefined): MetaCallbackReason {
  if (
    value === "denied" ||
    value === "state" ||
    value === "nocode" ||
    value === "session" ||
    value === "not_configured" ||
    value === "client_not_found" ||
    value === "exchange"
  ) {
    return value;
  }
  return "unknown";
}

export function describeCallbackReason(value: string | null | undefined): string {
  return CALLBACK_MESSAGE[parseCallbackReason(value)];
}

/**
 * Interpreta os parâmetros de erro que a Meta anexa ao redirect de callback.
 * Retorna `null` quando não há erro da Meta.
 */
export function describeMetaRedirectError(query: {
  error?: string | null;
  error_reason?: string | null;
  error_description?: string | null;
}): string | null {
  const error = query.error?.trim();
  if (!error) return null;

  if (
    error === "access_denied" ||
    query.error_reason === "user_denied" ||
    query.error_reason === "consumer_denied"
  ) {
    return "Você cancelou a autorização no Facebook.";
  }

  const detail = query.error_description?.trim();
  return detail
    ? `O Facebook recusou a autorização: ${detail}`
    : `O Facebook recusou a autorização (${error}).`;
}
