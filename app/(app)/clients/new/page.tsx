import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NewClientForm } from "@/components/clients/new-client-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default function NewClientPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Clientes
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          Novo cliente
        </h1>
        <p className="mt-1 text-sm text-muted">
          Dados básicos para iniciar o onboarding. A conexão com a Meta é feita
          depois.
        </p>
      </div>

      <NewClientForm />
    </div>
  );
}
