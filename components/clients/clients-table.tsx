"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  ClientStatusBadge,
  HealthScore,
  MetaStatusBadge,
} from "@/components/shared/status-badges";
import { formatCurrency } from "@/lib/format";
import type { ClientListItem } from "@/server/clients";

interface ClientsTableProps {
  rows: ClientListItem[];
}

export function ClientsTable({ rows }: ClientsTableProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const columns: readonly Column<ClientListItem>[] = [
    {
      key: "name",
      header: "Cliente",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-xs text-muted">{row.internalName}</span>
        </div>
      ),
    },
    {
      key: "meta",
      header: "Meta",
      render: (row) => <MetaStatusBadge status={row.metaStatus} />,
    },
    {
      key: "spend",
      header: "Investimento 30d",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatCurrency(row.spendLast30d)}</span>
      ),
    },
    {
      key: "health",
      header: "Health",
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
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Dropdown
          align="end"
          trigger={
            <span className="inline-flex rounded-md p-1.5 text-muted hover:bg-surface-elevated hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </span>
          }
        >
          <DropdownItem onSelect={() => router.push(`/clients/${row.id}`)}>
            Abrir cliente
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem onSelect={() => setPendingAction("Editar cliente")}>
            Editar
          </DropdownItem>
          <DropdownItem
            tone="danger"
            onSelect={() => setPendingAction("Arquivar cliente")}
          >
            Arquivar
          </DropdownItem>
        </Dropdown>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/clients/${row.id}`)}
        emptyMessage="Nenhum cliente encontrado com os filtros atuais."
      />

      <Modal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title={pendingAction ?? ""}
        description="Ação disponível em uma fase futura do produto."
        footer={
          <Button variant="secondary" onClick={() => setPendingAction(null)}>
            Entendi
          </Button>
        }
      >
        <p className="text-sm text-muted">
          O cadastro e a gestão de clientes ainda usam dados mockados. A
          persistência será conectada ao Supabase nas próximas entregas.
        </p>
      </Modal>
    </>
  );
}
