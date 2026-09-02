/**
 * Parâmetro `state` do OAuth da Meta — proteção anti-CSRF.
 *
 * Estratégia (decidida na META 2): cookie httpOnly, sem HMAC.
 *   - No início, geramos um `nonce` aleatório (32 bytes) e gravamos um cookie
 *     `httpOnly` + `Secure` + `SameSite=Lax` com o payload completo
 *     `{ nonce, clientId, uid, iat }`. O browser NÃO consegue ler nem forjar
 *     esse cookie via JS.
 *   - À Meta enviamos SÓ o `nonce` como `state`.
 *   - No callback, exigimos: cookie presente, não expirado (TTL 10 min),
 *     `state` da query === `nonce` do cookie (comparação em tempo constante).
 *     O `clientId` e o `uid` usados daí para a frente vêm SEMPRE do cookie,
 *     nunca da query — o frontend não consegue adulterar o cliente-alvo.
 *
 * Módulo PURO (sem `process.env`, sem `server-only`, sem `node:crypto`).
 */

export const META_OAUTH_STATE_COOKIE = "meta_oauth_state";

/** Caminho do cookie: cobre /start e /callback e nada mais. */
export const META_OAUTH_STATE_COOKIE_PATH = "/api/meta/oauth";

/** Validade do state: 10 minutos. */
export const META_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  /** Nonce aleatório (base64url). É o valor enviado como `state`. */
  nonce: string;
  /** Cliente Bernal alvo da conexão (UUID), validado no servidor no /start. */
  clientId: string;
  /** id do usuário Supabase que iniciou o fluxo. */
  uid: string;
  /** Date.now() da emissão. */
  iat: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** base64url de string ASCII (nonce/uuid/número — sem chars fora de Latin1). */
function b64urlEncode(ascii: string): string {
  return btoa(ascii).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

export function createStatePayload(input: {
  clientId: string;
  uid: string;
  nonce: string;
  now?: number;
}): OAuthStatePayload {
  return {
    nonce: input.nonce,
    clientId: input.clientId,
    uid: input.uid,
    iat: input.now ?? Date.now(),
  };
}

/** Serializa o payload para o valor do cookie. */
export function encodeStateCookie(payload: OAuthStatePayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

/** Faz o parse defensivo do valor do cookie. `null` se inválido. */
export function decodeStateCookie(
  raw: string | null | undefined,
): OAuthStatePayload | null {
  if (!isNonEmptyString(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (!isNonEmptyString(p.nonce)) return null;
  if (!isNonEmptyString(p.clientId)) return null;
  if (!isNonEmptyString(p.uid)) return null;
  if (typeof p.iat !== "number" || !Number.isFinite(p.iat)) return null;
  return { nonce: p.nonce, clientId: p.clientId, uid: p.uid, iat: p.iat };
}

/** Comparação de strings em tempo constante (evita timing-attack no nonce). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type StateValidation =
  | { ok: true; clientId: string; uid: string }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "nonce_mismatch" };

/**
 * Valida o `state` do callback contra o cookie.
 * NUNCA confia em `clientId`/`uid` vindos da query — só do cookie.
 */
export function validateState(args: {
  cookieRaw: string | null | undefined;
  stateParam: string | null | undefined;
  now?: number;
}): StateValidation {
  const now = args.now ?? Date.now();

  if (!isNonEmptyString(args.cookieRaw)) return { ok: false, reason: "missing" };

  const payload = decodeStateCookie(args.cookieRaw);
  if (!payload) return { ok: false, reason: "malformed" };

  if (now - payload.iat > META_OAUTH_STATE_TTL_MS || now < payload.iat) {
    return { ok: false, reason: "expired" };
  }

  if (
    !isNonEmptyString(args.stateParam) ||
    !timingSafeEqual(args.stateParam, payload.nonce)
  ) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  return { ok: true, clientId: payload.clientId, uid: payload.uid };
}
