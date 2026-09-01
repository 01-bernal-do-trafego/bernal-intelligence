import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
