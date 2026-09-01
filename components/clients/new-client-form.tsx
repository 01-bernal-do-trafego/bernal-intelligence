"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageIcon, LayoutDashboard, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { generateClientId } from "@/lib/id";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";

const STATUS_OPTIONS = (Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map(
  (value) => ({ value, label: CLIENT_STATUS_LABEL[value] }),
);

const STEPS = [
  { n: 1, label: "Dados do cliente" },
  { n: 2, label: "Conectar Meta Ads" },
  { n: 3, label: "Configurar dashboard" },
] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STEPS.map((step, index) => {
        const active = step.n === current;
        const done = step.n < current;
        return (
          <li key={step.n} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-full border text-[11px] font-medium",
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted",
              )}
            >
              {done ? <Check className="size-3" /> : step.n}
            </span>
            <span className={active ? "text-foreground" : "text-muted"}>
              {step.label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="mx-1 hidden h-px w-6 bg-border sm:inline-block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function NewClientForm() {
  const router = useRouter();
  const [clientId] = useState(generateClientId);
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
      <Stepper current={1} />

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
              placeholder="Ex.: Nome da empresa"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="internalName"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
            >
              Identificação interna
              <span className="text-xs font-normal text-muted">(opcional)</span>
            </label>
            <Input
              id="internalName"
              value={internalName}
              onChange={(e) => setInternalName(e.target.value)}
              placeholder="Como a equipe Bernal se refere a este cliente"
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

          <p className="text-xs text-muted">
            ID interno:{" "}
            <span className="font-mono text-foreground">{clientId}</span> · gerado
            automaticamente, independente do nome da empresa.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5 opacity-70">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                2 · Conectar Meta Ads
              </p>
              <p className="mt-1 text-sm text-muted">
                Conexão via OAuth com a Meta — etapa futura, ainda não
                implementada.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5 opacity-70">
            <LayoutDashboard className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                3 · Configurar dashboard
              </p>
              <p className="mt-1 text-sm text-muted">
                Métrica principal, cards e gráficos do cliente — etapa futura.
              </p>
            </div>
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
          com o ID{" "}
          <span className="font-mono text-foreground">{clientId}</span> e status{" "}
          <span className="text-foreground">{CLIENT_STATUS_LABEL[status]}</span>.
        </p>
      </Modal>
    </>
  );
}
