"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";

type ActionKey = "edit" | "share" | "export" | "duplicate";

const ACTION_CONTENT: Record<
  ActionKey,
  { title: string; intro: string; items: string[] }
> = {
  edit: {
    title: "Editar dashboard",
    intro:
      "A configuração de dashboard é salva por cliente. Nesta fase o layout é fixo; futuramente será possível:",
    items: [
      "escolher quais métricas aparecem",
      "escolher e ordenar os cards",
      "escolher e ordenar os gráficos",
      "escolher as tabelas exibidas",
      "reorganizar os componentes livremente",
      "salvar a configuração para este cliente",
      "aplicar e reutilizar templates",
    ],
  },
  share: {
    title: "Compartilhar dashboard",
    intro:
      "O dashboard compartilhável do cliente ainda não está ativo. Futuramente será possível:",
    items: [
      "gerar um link individual para o cliente",
      "ativar e desativar o link a qualquer momento",
      "escolher acesso público ou protegido",
      "definir senha ou login para o acesso protegido",
    ],
  },
  export: {
    title: "Exportar PDF",
    intro: "A exportação do dashboard em PDF entra em uma fase futura.",
    items: [],
  },
  duplicate: {
    title: "Duplicar dashboard",
    intro:
      "Duplicar a configuração deste dashboard para outro cliente entra em uma fase futura.",
    items: [],
  },
};

export function DashboardHeaderActions() {
  const [open, setOpen] = useState<ActionKey | null>(null);
  const content = open ? ACTION_CONTENT[open] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen("edit")}>
          <Pencil className="size-3.5" />
          Editar dashboard
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen("share")}>
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
          <DropdownItem onSelect={() => setOpen("export")}>
            Exportar PDF
          </DropdownItem>
          <DropdownItem onSelect={() => setOpen("duplicate")}>
            Duplicar
          </DropdownItem>
        </Dropdown>
      </div>

      <Modal
        open={content !== null}
        onClose={() => setOpen(null)}
        title={content?.title ?? ""}
        description="Recurso previsto para uma fase futura."
        footer={
          <Button variant="secondary" onClick={() => setOpen(null)}>
            Fechar
          </Button>
        }
      >
        {content && (
          <div className="space-y-3 text-sm text-muted">
            <p>{content.intro}</p>
            {content.items.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {content.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
