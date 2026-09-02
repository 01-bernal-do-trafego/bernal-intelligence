"use client";

import { useEffect, useState } from "react";
import { Check, MoreHorizontal, Pencil, Share2 } from "lucide-react";
import type { DashboardConfigValue } from "@/lib/dashboard-config";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { DashboardEditor } from "./dashboard-editor";

type PlaceholderKey = "share" | "export" | "duplicate";

const PLACEHOLDER: Record<
  PlaceholderKey,
  { title: string; intro: string; items: string[] }
> = {
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

interface DashboardHeaderActionsProps {
  clientId: string;
  config: DashboardConfigValue;
}

export function DashboardHeaderActions({
  clientId,
  config,
}: DashboardHeaderActionsProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [placeholder, setPlaceholder] = useState<PlaceholderKey | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(0), 3500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const placeholderContent = placeholder ? PLACEHOLDER[placeholder] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {savedAt > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-xs text-positive">
            <Check className="size-3.5" />
            Dashboard salvo
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditorOpen(true)}
        >
          <Pencil className="size-3.5" />
          Editar dashboard
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPlaceholder("share")}
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
          <DropdownItem onSelect={() => setPlaceholder("export")}>
            Exportar PDF
          </DropdownItem>
          <DropdownItem onSelect={() => setPlaceholder("duplicate")}>
            Duplicar
          </DropdownItem>
        </Dropdown>
      </div>

      {editorOpen && (
        <DashboardEditor
          clientId={clientId}
          initialConfig={config}
          onClose={() => setEditorOpen(false)}
          onSaved={() => setSavedAt(Date.now())}
        />
      )}

      <Modal
        open={placeholderContent !== null}
        onClose={() => setPlaceholder(null)}
        title={placeholderContent?.title ?? ""}
        description="Recurso previsto para uma fase futura."
        footer={
          <Button variant="secondary" onClick={() => setPlaceholder(null)}>
            Fechar
          </Button>
        }
      >
        {placeholderContent && (
          <div className="space-y-3 text-sm text-muted">
            <p>{placeholderContent.intro}</p>
            {placeholderContent.items.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {placeholderContent.items.map((item) => (
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
