"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  ClientStatusBadge,
  HealthScore,
  MetaStatusBadge,
} from "@/components/shared/status-badges";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { PortfolioClientRow } from "@/server/portfolio";

const columns: readonly Column<PortfolioClientRow>[] = [
  {
    key: "name",
    header: "Cliente",
    render: (row) => <span className="font-medium text-foreground">{row.name}</span>,
  },
  {
    key: "meta",
    header: "Meta",
    render: (row) => <MetaStatusBadge status={row.metaStatus} />,
  },
  {
    key: "spend",
    header: "Investimento",
    align: "right",
    render: (row) => <span className="tabular-nums">{formatCurrency(row.spend)}</span>,
  },
  {
    key: "results",
    header: "Resultados",
    align: "right",
    render: (row) => <span className="tabular-nums">{formatNumber(row.results)}</span>,
  },
  {
    key: "cpr",
    header: "Custo / resultado",
    align: "right",
    render: (row) =>
      row.results > 0 ? (
        <span className="tabular-nums">{formatCurrency(row.costPerResult)}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    key: "score",
    header: "Score",
    align: "right",
    render: (row) => (
      <HealthScore
        value={row.healthScore}
        connected={row.metaStatus === "connected"}
      />
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
      emptyMessage="Nenhum cliente com veiculação no período."
    />
  );
}
