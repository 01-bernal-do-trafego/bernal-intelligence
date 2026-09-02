/**
 * Classificação de erros da Graph API da Meta. Módulo PURO.
 *
 * A Edge Function tem a sua própria cópia mínima disto (fronteira Deno); esta
 * versão é usada pelo app Next para traduzir o `reason` devolvido pela função
 * em mensagem/estado de UI.
 */

export type MetaErrorKind =
  | "token_revoked" // 190 / OAuthException — reconectar
  | "insufficient_permission" // 10 / 200 / 294 / 299 — falta escopo/role
  | "rate_limited" // 4 / 17 / 32 / 613 — tentar depois
  | "transient" // 1 / 2 — instabilidade da Meta
  | "unknown";

/** Códigos de `error.code` da Meta -> classe. */
export function classifyMetaErrorCode(
  code: number | null | undefined,
  subcode?: number | null,
): MetaErrorKind {
  if (code == null) return "unknown";
  if (code === 190) return "token_revoked";
  if (code === 102 && subcode === 463) return "token_revoked";
  if ([10, 200, 294, 299, 272].includes(code)) return "insufficient_permission";
  if ([4, 17, 32, 613, 80000].includes(code)) return "rate_limited";
  if ([1, 2].includes(code)) return "transient";
  return "unknown";
}

/** Extrai a classe de um corpo de resposta `{ error: { code, error_subcode } }`. */
export function classifyMetaErrorBody(body: unknown): MetaErrorKind {
  if (typeof body !== "object" || body === null) return "unknown";
  const err = (body as Record<string, unknown>).error;
  if (typeof err !== "object" || err === null) return "unknown";
  const e = err as Record<string, unknown>;
  const code = typeof e.code === "number" ? e.code : null;
  const subcode = typeof e.error_subcode === "number" ? e.error_subcode : null;
  return classifyMetaErrorCode(code, subcode);
}

/** `reason` string (devolvido pela Edge Function / actions) -> mensagem PT. */
export type DiscoveryReason =
  | MetaErrorKind
  | "not_connected"
  | "no_connection_secret"
  | "function_unavailable"
  | "decrypt_failed"
  | "account_linked_elsewhere"
  | "ok";

const DISCOVERY_MESSAGE: Record<DiscoveryReason, string> = {
  token_revoked:
    "O acesso à Meta foi revogado ou expirou. Reconecte a Meta Ads para continuar.",
  insufficient_permission:
    "A autorização atual não tem permissão para listar as contas de anúncio. Reconecte concedendo o acesso a Anúncios.",
  rate_limited: "A Meta limitou as requisições agora. Tente novamente em alguns minutos.",
  transient: "A Meta está instável no momento. Tente novamente.",
  not_connected: "Este cliente ainda não tem a Meta Ads conectada.",
  no_connection_secret:
    "A credencial da Meta está incompleta. Reconecte a Meta Ads.",
  function_unavailable:
    "O serviço de descoberta de contas ainda não está disponível neste ambiente.",
  decrypt_failed:
    "Não foi possível abrir a credencial da Meta com segurança. Reconecte a Meta Ads.",
  account_linked_elsewhere:
    "Uma das contas selecionadas já está vinculada a outro cliente.",
  unknown: "Não foi possível consultar a Meta. Tente novamente.",
  ok: "",
};

export function parseDiscoveryReason(value: string | null | undefined): DiscoveryReason {
  const known: DiscoveryReason[] = [
    "token_revoked",
    "insufficient_permission",
    "rate_limited",
    "transient",
    "not_connected",
    "no_connection_secret",
    "function_unavailable",
    "decrypt_failed",
    "account_linked_elsewhere",
    "ok",
  ];
  return (known as string[]).includes(value ?? "")
    ? (value as DiscoveryReason)
    : "unknown";
}

export function describeDiscoveryReason(value: string | null | undefined): string {
  return DISCOVERY_MESSAGE[parseDiscoveryReason(value)];
}
