import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { appOrigin } from "@/lib/app-url";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  getAuthMode,
} from "./config";

const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * URL absoluta para um redirect de sessão. A origem vem de `NEXT_PUBLIC_APP_URL`
 * quando configurada (deploy atrás de reverse proxy); senão, da origem do
 * request (desenvolvimento). Nunca de `x-forwarded-host`.
 */
function redirectUrl(request: NextRequest, pathname: string): URL {
  return new URL(pathname, appOrigin(request));
}

/**
 * Renova a sessão do Supabase e protege as rotas autenticadas.
 * Chamado pelo `proxy.ts` da raiz (convenção do Next.js 16, ex-middleware).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const mode = getAuthMode();
  const { pathname } = request.nextUrl;

  // Modo demonstração (somente desenvolvimento): libera a navegação.
  if (mode === "demo") {
    return NextResponse.next({ request });
  }

  // Sem configuração em produção: nenhuma rota autenticada é acessível.
  if (mode === "unconfigured") {
    if (isPublic(pathname)) return NextResponse.next({ request });
    return NextResponse.redirect(redirectUrl(request, "/login"));
  }

  // Modo Supabase: valida a sessão real.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname)) {
    const url = redirectUrl(request, "/login");
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(redirectUrl(request, "/"));
  }

  return response;
}
