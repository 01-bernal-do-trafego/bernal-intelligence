import { DataTable, type Column } from "@/components/ui/data-table";
import { CampaignStatusBadge } from "@/components/shared/status-badges";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { DashboardCampaignRow } from "@/server/client-dashboard";

const columns: readonly Column<DashboardCampaignRow>[] = [
  {
    key: "name",
    header: "Campanha",
    render: (row) => <span className="font-medium text-foreground">{row.name}</span>,
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
    key: "ctr",
    header: "CTR",
    align: "right",
    render: (row) => <span className="tabular-nums">{formatPercent(row.ctr, 2)}</span>,
  },
  {
    key: "cpm",
    header: "CPM",
    align: "right",
    render: (row) => <span className="tabular-nums">{formatCurrency(row.cpm)}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <CampaignStatusBadge status={row.status} />,
  },
];

export function CampaignsTable({ rows }: { rows: DashboardCampaignRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="Nenhuma campanha com dados no período/seleção."
    />
  );
}
