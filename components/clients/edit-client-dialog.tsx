"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateClient } from "@/app/(app)/clients/actions";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";
import type { ClientRecord } from "@/types/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

const STATUS_OPTIONS = (Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map(
  (value) => ({ value, label: CLIENT_STATUS_LABEL[value] }),
);

interface EditClientDialogProps {
  client: ClientRecord;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditClientDialog({
  client,
  open,
  onClose,
  onSaved,
}: EditClientDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(client.name);
  const [internalName, setInternalName] = useState(client.internalName ?? "");
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    startTransition(async () => {
      const result = await updateClient(client.id, { name, internalName, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar cliente"
      description="Dados básicos do cliente."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="edit-name"
            className="text-sm font-medium text-foreground"
          >
            Nome do cliente
          </label>
          <Input
            id="edit-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="edit-internal"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            Identificação interna
            <span className="text-xs font-normal text-muted">(opcional)</span>
          </label>
          <Input
            id="edit-internal"
            value={internalName}
            onChange={(e) => setInternalName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="edit-status"
            className="text-sm font-medium text-foreground"
          >
            Status
          </label>
          <Select
            id="edit-status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value as ClientStatus)}
          />
        </div>

        {error && <p className="text-sm text-negative">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending} disabled={!name.trim()}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Botão + diálogo prontos para usar na página do cliente. */
export function EditClientButton({ client }: { client: ClientRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Editar cliente
      </Button>
      <EditClientDialog
        client={client}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
