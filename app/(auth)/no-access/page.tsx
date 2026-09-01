import type { Metadata } from "next";
import { signOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Acesso não liberado" };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Bernal Intelligence
          </span>
        </div>

        <h1 className="text-lg font-semibold text-foreground">
          Acesso não liberado
        </h1>
        <p className="mt-2 text-sm text-muted">
          Sua conta está autenticada, mas ainda não tem permissão para o painel da
          agência. Fale com um administrador da Bernal.
        </p>

        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary" className="w-full">
            Sair
          </Button>
        </form>
      </div>
    </main>
  );
}
