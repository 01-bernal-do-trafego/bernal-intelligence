"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ClientStatusBadge } from "@/components/shared/status-badges";
import type { PortfolioClientRow } from "@/server/portfolio";

const columns: readonly Column<PortfolioClientRow>[] = [
  {
    key: "name",
    header: "Cliente",
    render: (row) => (
      <div className="flex flex-col">
        <span className="font-medium text-foreground">{row.name}</span>
        {row.internalName && (
          <span className="text-xs text-muted">{row.internalName}</span>
        )}
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <ClientStatusBadge status={row.status} />,
  },
];

export function PortfolioClientsTable({ rows }: { rows: PortfolioClientRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/clients/${row.id}`)}
      emptyMessage="Nenhum cliente cadastrado ainda."
    />
  );
}
