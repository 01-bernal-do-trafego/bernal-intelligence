"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";

const STATUS_OPTIONS = (Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map(
  (value) => ({ value, label: CLIENT_STATUS_LABEL[value] }),
);

export function NewClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [internalName, setInternalName] = useState("");
  const [status, setStatus] = useState<ClientStatus>("onboarding");
  const [logoName, setLogoName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Sem persistência nesta fase — apenas confirma a experiência de cadastro.
    setSaved(true);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid gap-5 rounded-xl border border-border bg-surface p-5">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              Nome do cliente
            </label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Uniforte"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="internalName"
              className="text-sm font-medium text-foreground"
            >
              Nome interno
            </label>
            <Input
              id="internalName"
              value={internalName}
              onChange={(e) => setInternalName(e.target.value)}
              placeholder="Usado internamente pela equipe Bernal"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Logo</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted transition-colors hover:border-muted/40">
              <ImageIcon className="size-4" />
              {logoName ?? "Selecionar imagem (upload conectado em breve)"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? null)}
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="status"
              className="text-sm font-medium text-foreground"
            >
              Status
            </label>
            <Select
              id="status"
              className="sm:w-60"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value as ClientStatus)}
            />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5 opacity-70">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Conectar Meta Ads
            </p>
            <p className="mt-1 text-sm text-muted">
              Etapa futura — a conexão via OAuth com a Meta ainda não está
              implementada.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={!name.trim()}>
            Cadastrar cliente
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/clients")}
          >
            Cancelar
          </Button>
        </div>
      </form>

      <Modal
        open={saved}
        onClose={() => setSaved(false)}
        title="Cadastro registrado (mock)"
        description="A persistência no Supabase entra numa fase seguinte."
        footer={
          <Button onClick={() => router.push("/clients")}>
            Voltar para clientes
          </Button>
        }
      >
        <p className="text-sm text-muted">
          <span className="text-foreground">{name || "Cliente"}</span> seria criado
          com status <span className="text-foreground">{CLIENT_STATUS_LABEL[status]}</span>.
        </p>
      </Modal>
    </>
  );
}
