import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listClients } from "@/server/clients";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";
import { ClientsFilters } from "@/components/clients/clients-filters";
import { ClientsTable } from "@/components/clients/clients-table";

export const metadata: Metadata = { title: "Clientes" };

interface ClientsPageProps {
  searchParams: Promise<{ q?: string; status?: string }>;
}

const VALID_STATUS = new Set<string>(Object.keys(CLIENT_STATUS_LABEL));

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const sp = await searchParams;
  const search = sp.q ?? "";
  const status: ClientStatus | "all" =
    sp.status && VALID_STATUS.has(sp.status)
      ? (sp.status as ClientStatus)
      : "all";

  const clients = listClients({ search, status });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="mt-1 text-sm text-muted">
            {clients.length} cliente{clients.length === 1 ? "" : "s"} na carteira.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-4" />
          Novo cliente
        </Link>
      </header>

      <Suspense fallback={<div className="h-10" />}>
        <ClientsFilters />
      </Suspense>

      <ClientsTable rows={clients} />
    </div>
  );
}
