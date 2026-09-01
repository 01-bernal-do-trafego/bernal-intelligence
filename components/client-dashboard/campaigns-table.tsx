"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { CampaignStatusBadge } from "@/components/shared/status-badges";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { DashboardCampaignRow } from "@/server/client-dashboard";
import type { CampaignStatus, ResultMetricConfig } from "@/types/domain";

type SortKey = "spend" | "results" | "costPerResult" | "ctr" | "cpm";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | CampaignStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "ended", label: "Encerradas" },
];

interface CampaignsTableProps {
  rows: DashboardCampaignRow[];
  resultMetric: ResultMetricConfig;
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
  activeKey: SortKey;
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

export function CampaignsTable({ rows, resultMetric }: CampaignsTableProps) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "spend",
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
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (a[sort.key] - b[sort.key]) * factor);
  }, [rows, status, sort]);

  const sortHeader = (label: string, sortKey: SortKey) => (
    <SortHeader
      label={label}
      sortKey={sortKey}
      activeKey={sort.key}
      dir={sort.dir}
      onToggle={toggleSort}
    />
  );

  const columns: readonly Column<DashboardCampaignRow>[] = [
    {
      key: "name",
      header: "Campanha",
      render: (row) => (
        <span className="font-medium text-foreground">{row.name}</span>
      ),
    },
    {
      key: "spend",
      header: sortHeader("Investimento", "spend"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatCurrency(row.spend)}</span>
      ),
    },
    {
      key: "results",
      header: sortHeader(resultMetric.resultLabel, "results"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatNumber(row.results)}</span>
      ),
    },
    {
      key: "cpr",
      header: sortHeader(resultMetric.costLabel, "costPerResult"),
      align: "right",
      render: (row) =>
        row.results > 0 ? (
          <span className="tabular-nums">
            {formatCurrency(row.costPerResult)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "ctr",
      header: sortHeader("CTR", "ctr"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatPercent(row.ctr, 2)}</span>
      ),
    },
    {
      key: "cpm",
      header: sortHeader("CPM", "cpm"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatCurrency(row.cpm)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <CampaignStatusBadge status={row.status} />,
    },
  ];

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
        columns={columns}
        data={visibleRows}
        getRowId={(row) => row.id}
        emptyMessage="Nenhuma campanha com os filtros atuais."
      />
    </div>
  );
}
