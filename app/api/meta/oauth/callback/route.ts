/**
 * GET /api/meta/oauth/callback?code=...&state=...   (ou ?error=...)
 *
 * Retorno do diálogo de autorização da Meta. Ordem das checagens (a árvore de
 * decisão em si vive em `lib/meta/oauth-callback.ts`, testada isoladamente):
 *
 *   1. `?error=` da Meta (inclui cancelamento)      -> volta com meta=error&reason=denied
 *   2. sessão da equipe ausente                      -> /no-access
 *   3. state ausente / adulterado / expirado         -> /clients?meta=error&reason=state
 *   4. uid da sessão != uid do state                 -> /no-access
 *   5. sem `code`                                    -> volta com meta=error&reason=nocode
 *   6. usuário sem acesso ao cliente do state        -> /no-access
 *   7. ok -> POST server-to-server para a Edge Function `meta-oauth-exchange`
 *           (Authorization: Bearer <access_token do usuário>, body { code, clientId }).
 *           O `code` NÃO passa pelo browser de novo; o token nunca volta ao Next.
 *
 * O cookie `meta_oauth_state` é sempre limpo na resposta.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAgencyRole } from "@/lib/roles";
import { getSessionContext } from "@/supabase/auth";
import { createSupabaseServerClient } from "@/supabase/server";
import { SUPABASE_FUNCTIONS_URL } from "@/supabase/config";
import { getClientRecord } from "@/server/clients";
import {
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_COOKIE_PATH,
  validateState,
} from "@/lib/meta/oauth-state";
import { decideCallback } from "@/lib/meta/oauth-callback";

export const dynamic = "force-dynamic";

const EXCHANGE_FUNCTION = "meta-oauth-exchange";

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(META_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: META_OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin;
  const sp = request.nextUrl.searchParams;

  const back = (path: string) =>
    clearStateCookie(NextResponse.redirect(new URL(path, origin)));

  try {
    return await handleCallback(request, sp, back);
  } catch {
    // Qualquer falha inesperada: nunca deixa o cookie de state para trás.
    return back(`/clients?meta=error&reason=exchange`);
  }
}

async function handleCallback(
  request: NextRequest,
  sp: URLSearchParams,
  back: (path: string) => NextResponse,
): Promise<NextResponse> {
  const cookieRaw = request.cookies.get(META_OAUTH_STATE_COOKIE)?.value ?? null;
  const state = validateState({
    cookieRaw,
    stateParam: sp.get("state"),
  });

  const { user, profile } = await getSessionContext();
  const isAgency = Boolean(profile && isAgencyRole(profile.role));

  // Só revalidamos acesso ao cliente quando o state entregou um clientId.
  let canAccessClient = false;
  if (state.ok && user && isAgency) {
    const client = await getClientRecord(state.clientId);
    canAccessClient = Boolean(client);
  }

  const decision = decideCallback({
    query: {
      code: sp.get("code"),
      state: sp.get("state"),
      error: sp.get("error"),
      error_reason: sp.get("error_reason"),
      error_description: sp.get("error_description"),
    },
    state,
    session: { uid: user?.id ?? null, isAgency },
    canAccessClient,
  });

  const clientPath = state.ok ? `/clients/${state.clientId}` : "/clients";

  switch (decision.kind) {
    case "denied":
      return back(`${clientPath}?meta=error&reason=denied`);
    case "invalid_state":
      return back(`/clients?meta=error&reason=state`);
    case "missing_code":
      return back(`${clientPath}?meta=error&reason=nocode`);
    case "forbidden":
      return back(`/no-access`);
    case "exchange":
      break;
  }

  // --- troca segura via Edge Function -------------------------------------
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return back(`${clientPath}?meta=error&reason=session`);
  }

  if (!SUPABASE_FUNCTIONS_URL) {
    return back(`${clientPath}?meta=error&reason=exchange`);
  }

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${EXCHANGE_FUNCTION}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        code: decision.code,
        clientId: decision.clientId,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return back(`${clientPath}?meta=error&reason=exchange`);
    }
  } catch {
    return back(`${clientPath}?meta=error&reason=exchange`);
  }

  return back(`${clientPath}?meta=connected`);
}
