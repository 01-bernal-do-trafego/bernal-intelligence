import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { isAgencyRole, parseRole, type AppRole } from "@/lib/roles";
import { createSupabaseServerClient } from "./server";

export interface SessionProfile {
  role: AppRole;
  fullName: string | null;
}

export interface SessionContext {
  user: User | null;
  profile: SessionProfile | null;
}

/**
 * Usuário autenticado atual + seu profile (role/nome) lido de `public.profiles`.
 * A leitura passa pela RLS: o usuário só enxerga o próprio profile.
 * Qualquer falha (sem sessão, sem profile, role inválido) => profile `null`.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null };

  const { data, error } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return { user, profile: null };

  const role = parseRole((data as { role?: unknown }).role);
  if (!role) return { user, profile: null };

  const fullNameRaw = (data as { full_name?: unknown }).full_name;

  return {
    user,
    profile: {
      role,
      fullName: typeof fullNameRaw === "string" ? fullNameRaw : null,
    },
  };
}

/**
 * Exige uma sessão válida de membro da equipe Bernal.
 * - sem sessão      -> /login
 * - sem papel agência -> /no-access
 */
export async function requireAgencySession(): Promise<{
  user: User;
  profile: SessionProfile;
}> {
  const { user, profile } = await getSessionContext();

  if (!user) redirect("/login");
  if (!profile || !isAgencyRole(profile.role)) redirect("/no-access");

  return { user, profile };
}
