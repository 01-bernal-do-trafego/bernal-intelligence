import { redirect } from "next/navigation";
import { getAuthMode } from "@/supabase/config";
import { requireAgencySession } from "@/supabase/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const mode = getAuthMode();

  // Produção sem Supabase configurado: nada aqui é acessível.
  if (mode === "unconfigured") {
    redirect("/login");
  }

  // Modo demonstração (apenas local, sem Supabase): sem sessão real.
  if (mode === "demo") {
    return (
      <AppShell demo>
        {children}
      </AppShell>
    );
  }

  // Modo Supabase: exige sessão de membro da equipe Bernal.
  const { user, profile } = await requireAgencySession();

  return (
    <AppShell
      email={user.email ?? undefined}
      displayName={profile.fullName ?? undefined}
      role={profile.role}
    >
      {children}
    </AppShell>
  );
}
