"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { CampaignStatusBadge } from "@/components/shared/status-badges";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { DashboardCampaignRow } from "@/server/client-dashboard";
import type { CampaignStatus, ResultMetricConfig } from "@/types/domain";

type SortKey =
  | "spend"
  | "results"
  | "costPerResult"
  | "reach"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | CampaignStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "ended", label: "Encerradas" },
];

interface ColumnDef {
  header: string;
  render: (row: DashboardCampaignRow) => ReactNode;
  align?: "left" | "right";
  sortKey?: SortKey;
}

function currencyOrDash(value: number, hasBase: boolean) {
  return hasBase ? (
    <span className="tabular-nums">{formatCurrency(value)}</span>
  ) : (
    <span className="text-muted">—</span>
  );
}

function columnDefs(metric: ResultMetricConfig): Record<string, ColumnDef> {
  return {
    campaign: {
      header: "Campanha",
      render: (r) => <span className="font-medium text-foreground">{r.name}</span>,
    },
    status: {
      header: "Status",
      render: (r) => <CampaignStatusBadge status={r.status} />,
    },
    investment: {
      header: "Investimento",
      align: "right",
      sortKey: "spend",
      render: (r) => <span className="tabular-nums">{formatCurrency(r.spend)}</span>,
    },
    results: {
      header: metric.resultLabel,
      align: "right",
      sortKey: "results",
      render: (r) => <span className="tabular-nums">{formatNumber(r.results)}</span>,
    },
    cost_per_result: {
      header: metric.costLabel,
      align: "right",
      sortKey: "costPerResult",
      render: (r) => currencyOrDash(r.costPerResult, r.results > 0),
    },
    reach: {
      header: "Alcance",
      align: "right",
      sortKey: "reach",
      render: (r) => <span className="tabular-nums">{formatNumber(r.reach)}</span>,
    },
    impressions: {
      header: "Impressões",
      align: "right",
      sortKey: "impressions",
      render: (r) => (
        <span className="tabular-nums">{formatNumber(r.impressions)}</span>
      ),
    },
    clicks: {
      header: "Cliques",
      align: "right",
      sortKey: "clicks",
      render: (r) => <span className="tabular-nums">{formatNumber(r.clicks)}</span>,
    },
    ctr: {
      header: "CTR",
      align: "right",
      sortKey: "ctr",
      render: (r) => <span className="tabular-nums">{formatPercent(r.ctr, 2)}</span>,
    },
    cpc: {
      header: "CPC",
      align: "right",
      sortKey: "cpc",
      render: (r) => currencyOrDash(r.cpc, r.clicks > 0),
    },
    cpm: {
      header: "CPM",
      align: "right",
      sortKey: "cpm",
      render: (r) => <span className="tabular-nums">{formatCurrency(r.cpm)}</span>,
    },
  };
}

interface CampaignsTableProps {
  rows: DashboardCampaignRow[];
  resultMetric: ResultMetricConfig;
  /** Chaves de coluna habilitadas, na ordem (começa sempre por "campaign"). */
  columns: string[];
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "-mr-1 ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted",
      )}
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}

export function CampaignsTable({
  rows,
  resultMetric,
  columns: columnKeys,
}: CampaignsTableProps) {
  const defs = useMemo(() => columnDefs(resultMetric), [resultMetric]);
  const activeKeys = columnKeys.filter((k) => defs[k]);
  const firstSortable =
    (activeKeys.map((k) => defs[k]?.sortKey).find(Boolean) as SortKey | undefined) ??
    null;

  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey | null; dir: SortDir }>({
    key: activeKeys.includes("investment") ? "spend" : firstSortable,
    dir: "desc",
  });

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }

  const visibleRows = useMemo(() => {
    const filtered =
      status === "all" ? rows : rows.filter((r) => r.status === status);
    if (!sort.key) return filtered;
    const key = sort.key;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (a[key] - b[key]) * factor);
  }, [rows, status, sort]);

  const tableColumns: readonly Column<DashboardCampaignRow>[] = activeKeys.map(
    (key) => {
      const def = defs[key];
      const header =
        def.sortKey != null ? (
          <SortHeader
            label={def.header}
            sortKey={def.sortKey}
            activeKey={sort.key}
            dir={sort.dir}
            onToggle={toggleSort}
          />
        ) : (
          def.header
        );
      return {
        key,
        header,
        align: def.align ?? "left",
        render: def.render,
      };
    },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 self-start rounded-lg border border-border bg-surface p-1">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setStatus(option.value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              status === option.value
                ? "bg-accent-soft text-accent"
                : "text-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={tableColumns}
        data={visibleRows}
        getRowId={(row) => row.id}
        emptyMessage="Nenhuma campanha com os filtros atuais."
      />
    </div>
  );
}
