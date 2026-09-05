"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageIcon, LayoutDashboard, Lock } from "lucide-react";
import { createClient } from "@/app/(app)/clients/actions";
import { cn } from "@/lib/cn";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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
  const [name, setName] = useState("");
  const [internalName, setInternalName] = useState("");
  const [status, setStatus] = useState<ClientStatus>("onboarding");
  const [logoName, setLogoName] = useState<string | null>(null);
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
      const result = await createClient({ name, internalName, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/clients/${result.id}?created=1`);
    });
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

        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                2 · Conectar Meta Ads
              </p>
              <p className="mt-1 text-sm text-muted">
                Depois de cadastrar, abra o perfil do cliente para conectar a
                Meta Ads e vincular as contas de anúncio.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5">
            <LayoutDashboard className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                3 · Configurar dashboard
              </p>
              <p className="mt-1 text-sm text-muted">
                Ajuste o resultado principal, os cards e os gráficos do cliente
                no editor do dashboard.
              </p>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-negative">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" loading={pending} disabled={!name.trim()}>
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
    </>
  );
}
