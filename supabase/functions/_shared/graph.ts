/**
 * Chamadas à Graph API da Meta feitas pela Edge Function (server-to-server).
 * Fronteira Deno — não importa de `lib/` do app Next.
 */

export interface GraphConfig {
  /** Ex.: "https://graph.facebook.com" */
  graphBase: string;
  /** Ex.: "v26.0" */
  version: string;
}

export interface ExchangeCodeInput extends GraphConfig {
  appId: string;
  appSecret: string;
  /** Idêntico ao redirect_uri usado no diálogo de autorização. */
  redirectUri: string;
  code: string;
}

export interface ExchangedToken {
  accessToken: string;
  tokenType: string | null;
  /** segundos até expirar; 0/ausente = não expira (system user). */
  expiresIn: number | null;
}

/** Troca o `code` do callback por um access token. */
export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
): Promise<ExchangedToken> {
  const url = new URL(
    `${input.graphBase.replace(/\/+$/, "")}/${input.version}/oauth/access_token`,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);

  const res = await fetch(url, { method: "GET" });
  const body = (await res.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!res.ok || !body || typeof body.access_token !== "string") {
    const detail =
      body && typeof body.error === "object" && body.error
        ? JSON.stringify(body.error)
        : `HTTP ${res.status}`;
    throw new Error(`Falha na troca do code: ${detail}`);
  }

  return {
    accessToken: body.access_token,
    tokenType: typeof body.token_type === "string" ? body.token_type : null,
    expiresIn:
      typeof body.expires_in === "number" ? body.expires_in : null,
  };
}

export interface DebugTokenInfo {
  scopes: string[];
  metaUserId: string | null;
  metaBusinessId: string | null;
  /** ISO ou null (null = não expira). */
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  isSystemUser: boolean;
}

/** `GET /debug_token` usando o app access token (`{app_id}|{app_secret}`). */
export async function debugToken(
  input: GraphConfig & { appId: string; appSecret: string; token: string },
): Promise<DebugTokenInfo> {
  const url = new URL(
    `${input.graphBase.replace(/\/+$/, "")}/${input.version}/debug_token`,
  );
  url.searchParams.set("input_token", input.token);
  url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);

  const res = await fetch(url, { method: "GET" });
  const body = (await res.json().catch(() => null)) as
    | { data?: Record<string, unknown> }
    | null;
  const d = body?.data ?? {};

  const toIso = (v: unknown): string | null =>
    typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;

  return {
    scopes: Array.isArray(d.scopes)
      ? (d.scopes.filter((s) => typeof s === "string") as string[])
      : [],
    metaUserId: d.user_id != null ? String(d.user_id) : null,
    metaBusinessId:
      typeof d.profile_id === "string"
        ? d.profile_id
        : d.profile_id != null
          ? String(d.profile_id)
          : null,
    expiresAt: toIso(d.expires_at),
    dataAccessExpiresAt: toIso(d.data_access_expires_at),
    isSystemUser: d.type === "SYSTEM_USER",
  };
}
