import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
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
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-muted">
          O endereço que você tentou abrir não existe ou foi movido.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
        >
          Voltar para a Visão geral
        </Link>
      </div>
    </main>
  );
}
