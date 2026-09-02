"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { archiveClient } from "@/app/(app)/clients/actions";
import type { ClientRecord } from "@/types/client";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  ClientStatusBadge,
  MetaStatusBadge,
} from "@/components/shared/status-badges";
import { EditClientDialog } from "./edit-client-dialog";

interface ClientsTableProps {
  rows: ClientRecord[];
}

const Placeholder = () => <span className="text-muted">—</span>;

export function ClientsTable({ rows }: ClientsTableProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [archiving, setArchiving] = useState<ClientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmArchive() {
    if (!archiving) return;
    setError(null);
    const target = archiving;
    startTransition(async () => {
      const result = await archiveClient(target.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setArchiving(null);
      router.refresh();
    });
  }

  const columns: readonly Column<ClientRecord>[] = [
    {
      key: "name",
      header: "Cliente",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-xs text-muted">{row.internalName ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "meta",
      header: "Conexão Meta",
      render: () => (
        <div className="flex flex-col gap-1">
          <MetaStatusBadge status="not_connected" />
          <span className="text-xs text-muted">Última sincronização: —</span>
        </div>
      ),
    },
    {
      key: "spend",
      header: "Investimento 30d",
      align: "right",
      render: () => <Placeholder />,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: () => <Placeholder />,
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
          <DropdownItem onSelect={() => setEditing(row)}>Editar</DropdownItem>
          {row.status !== "archived" && (
            <DropdownItem tone="danger" onSelect={() => setArchiving(row)}>
              Arquivar
            </DropdownItem>
          )}
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

      {editing && (
        <EditClientDialog
          client={editing}
          open
          onClose={() => setEditing(null)}
        />
      )}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title="Arquivar cliente"
        description={
          archiving
            ? `"${archiving.name}" ficará como arquivado.`
            : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchiving(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={pending} onClick={confirmArchive}>
              Arquivar
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          O cliente não é apagado do banco e continua acessível pelo filtro de
          status “Arquivado”.
        </p>
        {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      </Modal>
    </>
  );
}
