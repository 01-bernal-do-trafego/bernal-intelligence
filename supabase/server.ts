import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { isInShareContext } from "./share-context";
import { createSupabaseServiceClient } from "./service";

/**
 * Cliente Supabase para Server Components / Route Handlers / Server Actions.
 * Lê e escreve a sessão via cookies do Next.
 *
 * EXCEÇÃO (MVP COMERCIAL 1.0 — Client Dashboard Share Link): dentro de
 * `supabase/share-context.ts#runInShareContext` (só a rota pública
 * `/share/<token>`, depois do token já validado) não existe sessão de
 * usuário — devolve o client `service_role` (`supabase/service.ts`) em vez
 * do client de cookies, para que TODO o query layer existente (que sempre
 * chamou esta função) funcione sem nenhuma alteração. RLS continua intacta
 * para qualquer chamada fora desse contexto.
 */
export async function createSupabaseServerClient() {
  if (isInShareContext()) {
    return createSupabaseServiceClient();
  }

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` chamado de um Server Component — ignorável quando o
          // proxy já cuida de renovar a sessão.
        }
      },
    },
  });
}

/** Usuário autenticado atual, ou `null`. */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
