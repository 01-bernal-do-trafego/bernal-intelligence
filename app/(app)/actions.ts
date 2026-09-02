"use server";

import { cookies } from "next/headers";
import { getAuthMode } from "@/supabase/config";
import { createSupabaseServerClient } from "@/supabase/server";

/**
 * Encerra a sessão do Supabase e remove os cookies de sessão.
 * Não faz redirect: quem chama decide a navegação (hard nav para /login),
 * garantindo que o proxy revalide a ausência de sessão.
 */
export async function signOut(): Promise<void> {
  if (getAuthMode() !== "supabase") return;

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Rede de segurança: nenhum cookie de sessão sb-* pode sobrar.
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      jar.delete(cookie.name);
    }
  }
}
