"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuthMode } from "@/supabase/config";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginFormProps {
  mode: AuthMode;
  redirectTo?: string;
}

export function LoginForm({ mode, redirectTo = "/" }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  function goToApp() {
    startTransition(() => {
      router.replace(redirectTo);
      router.refresh();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError("E-mail ou senha inválidos.");
        return;
      }
      goToApp();
    } catch {
      setError("Não foi possível conectar ao Supabase. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "unconfigured") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
        Autenticação não configurada. Defina{" "}
        <code className="text-warning">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
        <code className="text-warning">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
        no ambiente para habilitar o acesso.
      </div>
    );
  }

  if (mode === "demo") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Ambiente local sem Supabase configurado. Entre em modo demonstração
          para explorar a interface com dados fictícios.
        </p>
        <Button className="w-full" onClick={goToApp} loading={pending}>
          Entrar em modo demonstração
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          E-mail
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@bernaldotrafego.com.br"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Senha
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <Button type="submit" className="w-full" loading={submitting || pending}>
        Entrar
      </Button>
    </form>
  );
}
