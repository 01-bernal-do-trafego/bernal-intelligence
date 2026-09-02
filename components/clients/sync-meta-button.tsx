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

      {state.kind === "done" && (
        <div className="flex flex-col gap-1 text-sm">
          {state.results.length === 0 && (
            <span className="text-muted">Nenhuma conta processada.</span>
          )}
          {state.results.map((r) => (
            <span
              key={r.adAccountId}
              className={
                r.status === "success"
                  ? "text-positive"
                  : r.status === "partial"
                    ? "text-warning"
                    : "text-negative"
              }
            >
              {r.adAccountId}:{" "}
              {r.error
                ? describeDiscoveryReason(r.error)
                : r.status === "success"
                  ? "sincronizada"
                  : r.status === "partial"
                    ? "parcial — parte dos dados não veio"
                    : "falhou"}
              {r.stats
                ? ` (${Number(r.stats.campaigns ?? 0)} camp. · ${Number(
                    r.stats.ads ?? 0,
                  )} anúncios · ${Number(r.stats.insights_daily ?? 0)} linhas/dia)`
                : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
