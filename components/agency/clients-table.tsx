"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { MetaConnectionBadge } from "@/components/shared/status-badges";
import { ConnectMetaButton } from "@/components/clients/connect-meta-button";
import {
  PERFORMANCE_STATUS_LABEL,
  PERFORMANCE_STATUS_TONE,
  CREATIVES_STATUS_LABEL,
  CREATIVES_STATUS_TONE,
} from "@/lib/meta/sync-health-labels";
import {
  clientRowFlags,
  filterClientRows,
  sortClientRows,
  type ClientFilterKey,
  type ClientSortKey,
  type SortDir,
} from "@/lib/meta/agency-clients-table";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatDate, formatCurrencyOrDash, formatNumberOrDash } from "@/lib/format";
import type { AgencyOverviewClientRow } from "@/server/agency-overview";

const FILTER_OPTIONS: { value: ClientFilterKey; label: string }[] = [
  { value: "all", label: "Todos os clientes" },
  { value: "fresh", label: "Atualizados" },
  { value: "stale", label: "Atrasados" },
  { value: "no_meta", label: "Sem Meta" },
  { value: "problem", label: "Com problema de sincronização" },
];

const SORT_OPTIONS: { value: ClientSortKey; label: string }[] = [
  { value: "spend", label: "Investimento" },
  { value: "results", label: "Resultados" },
  { value: "cost_per_result", label: "Custo por resultado" },
  { value: "last_sync", label: "Última sincronização" },
];

/**
 * Tabela operacional de clientes — CENTRAL da Visão Geral. 100% dado real:
 * Meta (meta_connections), Investimento/Resultados (agregado do período,
 * mesma resolução do dashboard individual), Performance/Criativos
 * (meta_client_sync_health), Última sync (relativa). Sem dado -> "—", nunca 0.
 */
export function AgencyClientsTable({
  rows,
}: {
  rows: readonly AgencyOverviewClientRow[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ClientFilterKey>("all");
  const [sortKey, setSortKey] = useState<ClientSortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => filterClientRows(rows, filter), [rows, filter]);

  const sorted = useMemo(
    () => sortClientRows(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const columns: Column<AgencyOverviewClientRow>[] = [
    {
      key: "client",
      header: "Cliente",
      render: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: "meta",
      header: "Meta",
      render: (row) => <MetaConnectionBadge state={row.metaState} />,
    },
    {
      key: "spend",
      header: "Investimento",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatCurrencyOrDash(row.aggregate.spend)}</span>
      ),
    },
    {
      key: "result_label",
      header: "Resultado principal",
      render: (row) => <span className="text-muted">{row.aggregate.resultLabel}</span>,
    },
    {
      key: "results",
      header: "Resultados",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatNumberOrDash(row.aggregate.results)}</span>
      ),
    },
    {
      key: "cost_per_result",
      header: "Custo/resultado",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatCurrencyOrDash(row.aggregate.costPerResult)}</span>
      ),
    },
    {
      key: "performance",
      header: "Performance",
      render: (row) => (
        <Badge tone={PERFORMANCE_STATUS_TONE[row.performanceStatus]} dot>
          {PERFORMANCE_STATUS_LABEL[row.performanceStatus]}
        </Badge>
      ),
    },
    {
      key: "creatives",
      header: "Criativos",
      render: (row) => (
        <Badge tone={CREATIVES_STATUS_TONE[row.creativesStatus]} dot>
          {CREATIVES_STATUS_LABEL[row.creativesStatus]}
        </Badge>
      ),
    },
    {
      key: "last_sync",
      header: "Última sync",
      render: (row) => (
        <span title={row.lastSyncAt ? formatDate(row.lastSyncAt.slice(0, 10)) : undefined}>
          {formatRelativeTime(row.lastSyncAt)}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (row) =>
        clientRowFlags(row).noMeta ? (
          <ConnectMetaButton
            clientId={row.clientId}
            state={row.metaState}
            className="h-8 px-3 text-xs"
          />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/clients/${row.clientId}`);
            }}
          >
            Abrir dashboard
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Filtrar clientes"
          className="w-56"
          value={filter}
          options={FILTER_OPTIONS}
          onChange={(e) => setFilter(e.target.value as ClientFilterKey)}
        />
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Ordenar por</span>
          <Select
            aria-label="Ordenar por"
            className="w-48"
            value={sortKey}
            options={SORT_OPTIONS}
            onChange={(e) => setSortKey(e.target.value as ClientSortKey)}
          />
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-lg border border-border px-2 py-1.5 text-foreground hover:border-muted/40"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={sorted}
        getRowId={(row) => row.clientId}
        onRowClick={(row) => router.push(`/clients/${row.clientId}`)}
        emptyMessage="Nenhum cliente neste filtro."
      />
    </div>
  );
}
