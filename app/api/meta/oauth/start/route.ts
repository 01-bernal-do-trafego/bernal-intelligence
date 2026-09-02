/**
 * GET /api/meta/oauth/start?clientId=<uuid>
 *
 * Início do OAuth da Meta (Facebook Login for Business). Passos:
 *   1. Exige sessão da equipe Bernal (agency_admin | agency_member).
 *   2. Valida o `clientId` contra a RLS (o usuário precisa enxergar o cliente).
 *   3. Gera um `nonce` aleatório + grava o cookie httpOnly `meta_oauth_state`
 *      com `{ nonce, clientId, uid, iat }`.
 *   4. Redireciona para o diálogo de autorização da Meta, enviando SÓ o `nonce`
 *      como `state`.
 *
 * O `clientId` nunca mais é lido da query depois daqui — o callback usa só o
 * valor selado no cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAgencyRole } from "@/lib/roles";
import { getSessionContext } from "@/supabase/auth";
import { getClientRecord } from "@/server/clients";
import { buildAuthorizationUrl } from "@/lib/meta/oauth-url";
import {
  createStatePayload,
  encodeStateCookie,
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_COOKIE_PATH,
  META_OAUTH_STATE_TTL_MS,
} from "@/lib/meta/oauth-state";
import { isMetaOAuthConfigured, metaOAuthConfig } from "@/lib/meta/oauth-config";

export const dynamic = "force-dynamic";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const clientIdParam = request.nextUrl.searchParams.get("clientId") ?? "";

  const { user, profile } = await getSessionContext();
  if (!user || !profile || !isAgencyRole(profile.role)) {
    const back = new URL("/login", request.nextUrl.origin);
    back.searchParams.set("redirectTo", `/clients/${clientIdParam}`);
    return NextResponse.redirect(back);
  }

  if (!isMetaOAuthConfigured()) {
    return redirectTo(
      request,
      `/clients/${clientIdParam}?meta=error&reason=not_configured`,
    );
  }

  // RLS: retorna null se o cliente não existe ou o usuário não pode vê-lo.
  const client = await getClientRecord(clientIdParam);
  if (!client) {
    return redirectTo(request, `/clients?meta=error&reason=client_not_found`);
  }

  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const payload = createStatePayload({
    clientId: client.id,
    uid: user.id,
    nonce,
  });

  const cfg = metaOAuthConfig();
  const authUrl = buildAuthorizationUrl({
    loginBase: cfg.loginBase,
    version: cfg.version,
    appId: cfg.appId,
    configId: cfg.configId,
    redirectUri: cfg.redirectUri,
    state: nonce,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(META_OAUTH_STATE_COOKIE, encodeStateCookie(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: META_OAUTH_STATE_COOKIE_PATH,
    maxAge: Math.floor(META_OAUTH_STATE_TTL_MS / 1000),
  });
  return response;
}
