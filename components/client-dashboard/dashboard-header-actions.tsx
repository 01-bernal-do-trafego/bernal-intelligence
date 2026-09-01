"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";

export function DashboardHeaderActions() {
  const [openAction, setOpenAction] = useState<string | null>(null);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpenAction("Editar dashboard")}
        >
          <Pencil className="size-3.5" />
          Editar dashboard
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpenAction("Compartilhar")}
        >
          <Share2 className="size-3.5" />
          Compartilhar
        </Button>
        <Dropdown
          align="end"
          trigger={
            <span className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-elevated px-2 text-muted hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </span>
          }
        >
          <DropdownItem onSelect={() => setOpenAction("Exportar PDF")}>
            Exportar PDF
          </DropdownItem>
          <DropdownItem onSelect={() => setOpenAction("Duplicar dashboard")}>
            Duplicar
          </DropdownItem>
        </Dropdown>
      </div>

      <Modal
        open={openAction !== null}
        onClose={() => setOpenAction(null)}
        title={openAction ?? ""}
        description="Recurso previsto para uma fase futura."
        footer={
          <Button variant="secondary" onClick={() => setOpenAction(null)}>
            Fechar
          </Button>
        }
      >
        <p className="text-sm text-muted">
          O dashboard compartilhável e a edição de layout ainda não estão
          disponíveis nesta versão de fundação.
        </p>
      </Modal>
    </>
  );
}
