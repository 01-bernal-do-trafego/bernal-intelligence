import type { Metadata } from "next";
import { getAuthMode } from "@/supabase/config";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirectTo } = await searchParams;
  const mode = getAuthMode();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Bernal Intelligence
          </span>
        </div>

        <h1 className="text-xl font-semibold text-foreground">Acessar o painel</h1>
        <p className="mt-1 text-sm text-muted">
          Plataforma de inteligência de mídia paga da Bernal.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-surface p-6">
          <LoginForm mode={mode} redirectTo={redirectTo || "/"} />
        </div>
      </div>
    </main>
  );
}
