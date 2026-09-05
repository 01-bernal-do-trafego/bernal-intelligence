"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncMeta, type SyncRunResult } from "@/app/(app)/clients/[id]/meta-sync-actions";
import { describeDiscoveryReason } from "@/lib/meta/graph-errors";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "idle" }
  | { kind: "error"; reason: string }
  | { kind: "done"; results: SyncRunResult[]; dateFrom: string | null; dateTo: string | null };

/** Resumo amigável do resultado — sem ids de conta nem contagem de stages. */
function DoneMessage({ results }: { results: SyncRunResult[] }) {
  if (results.length === 0) {
    return <span className="text-sm text-muted">Nenhuma conta para sincronizar.</span>;
  }
  const failed = results.filter((r) => r.status === "error").length;
  const partial = results.filter((r) => r.status === "partial").length;
  if (failed === results.length) {
    return (
      <span className="text-sm text-negative">
        A sincronização falhou. Tente novamente em instantes.
      </span>
    );
  }
  if (failed > 0 || partial > 0) {
    return (
      <span className="text-sm text-warning">
        Sincronização concluída parcialmente — parte dos dados não veio. Tente
        novamente.
      </span>
    );
  }
  return (
    <span className="text-sm text-positive">
      Dados atualizados. Pode levar alguns segundos para aparecer.
    </span>
  );
}

export function SyncMetaButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function run() {
    setState({ kind: "idle" });
    startTransition(async () => {
      const res = await syncMeta(clientId);
      if (!res.ok) {
        setState({ kind: "error", reason: res.reason });
        return;
      }
      setState({
        kind: "done",
        results: res.results,
        dateFrom: res.dateFrom,
        dateTo: res.dateTo,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" onClick={run} loading={pending} disabled={pending}>
        <RefreshCw className="size-3.5" />
        {pending ? "Sincronizando…" : "Sincronizar Meta"}
      </Button>

      {state.kind === "error" && (
        <p className="text-sm text-negative">
          {describeDiscoveryReason(state.reason)}
        </p>
      )}

      {state.kind === "done" && <DoneMessage results={state.results} />}
    </div>
  );
}
