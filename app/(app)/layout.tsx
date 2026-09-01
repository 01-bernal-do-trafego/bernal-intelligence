import { redirect } from "next/navigation";
import { getAuthMode } from "@/supabase/config";
import { getCurrentUser } from "@/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: LayoutProps<"/">) {
  const mode = getAuthMode();

  if (mode === "unconfigured") {
    redirect("/login");
  }

  let userEmail: string | undefined;
  if (mode === "supabase") {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    userEmail = user.email ?? undefined;
  }

  return (
    <AppShell userEmail={userEmail} demo={mode === "demo"}>
      {children}
    </AppShell>
  );
}
