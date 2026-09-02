"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, RefreshCw } from "lucide-react";
import type { ClientAdAccount } from "@/lib/meta/ad-account";
import { accountStatusLabel } from "@/lib/meta/ad-account";
import { utcOffsetLabel } from "@/lib/meta/timezone";
import { describeDiscoveryReason } from "@/lib/meta/graph-errors";
import {
  discoverAdAccounts,
  saveLinkedAdAccounts,
} from "@/app/(app)/clients/[id]/meta-accounts-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";

interface ManageMetaConnectionProps {
  clientId: string;
  initialAccounts: ClientAdAccount[];
}

type Notice =
  | { kind: "idle" }
  | { kind: "error"; reason: string }
  | { kind: "saved"; count: number }
  | { kind: "discovered"; count: number };

export function ManageMetaConnection({
  clientId,
  initialAccounts,
}: ManageMetaConnectionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<ClientAdAccount[]>(initialAccounts);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialAccounts.filter((a) => a.isLinked).map((a) => a.adAccountId)),
  );
  const [didDiscover, setDidDiscover] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "idle" });
  const [discovering, startDiscover] = useTransition();
  const [saving, startSave] = useTransition();

  const linkedNow = useMemo(
    () => accounts.filter((a) => a.isLinked),
    [accounts],
  );

  const dirty = useMemo(() => {
    const current = new Set(
      accounts.filter((a) => a.isLinked).map((a) => a.adAccountId),
    );
    if (current.size !== selected.size) return true;
    for (const id of selected) if (!current.has(id)) return true;
    return false;
  }, [accounts, selected]);

  function sync(next: ClientAdAccount[]) {
    setAccounts(next);
    setSelected(new Set(next.filter((a) => a.isLinked).map((a) => a.adAccountId)));
  }

  function runDiscover() {
    setNotice({ kind: "idle" });
    startDiscover(async () => {
      const res = await discoverAdAccounts(clientId);
      setDidDiscover(true);
      if (!res.ok) {
        setNotice({ kind: "error", reason: res.reason });
        return;
      }
      sync(res.accounts);
      setNotice({ kind: "discovered", count: res.accounts.length });
      router.refresh();
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runSave() {
    setNotice({ kind: "idle" });
    startSave(async () => {
      const res = await saveLinkedAdAccounts(clientId, [...selected]);
      if (!res.ok) {
        setNotice({ kind: "error", reason: res.reason });
        return;
      }
      sync(res.accounts);
      setNotice({
        kind: "saved",
        count: res.accounts.filter((a) => a.isLinked).length,
      });
      router.refresh();
    });
  }

  const busy = discovering || saving;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Gerenciar conexão
      </Button>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Contas de anúncio da Meta"
        description="Escolha quais contas este cliente usa no dashboard. A busca é feita no servidor; o token nunca passa pelo navegador."
        className="max-w-xl"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Fechar
            </Button>
            <Button
              size="sm"
              onClick={runSave}
              loading={saving}
              disabled={busy || !dirty || accounts.length === 0}
            >
              Salvar contas
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {accounts.length === 0
                ? "Nenhuma conta carregada ainda."
                : `${accounts.length} conta(s) · ${linkedNow.length} vinculada(s)`}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={runDiscover}
              loading={discovering}
              disabled={busy}
            >
              <RefreshCw className="size-3.5" />
              {accounts.length === 0 ? "Buscar contas na Meta" : "Atualizar lista"}
            </Button>
          </div>

          {notice.kind === "error" && (
            <div className="rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
              {describeDiscoveryReason(notice.reason)}
            </div>
          )}
          {notice.kind === "saved" && (
            <div className="rounded-lg border border-positive/30 bg-positive/10 px-3 py-2 text-sm text-positive">
              Contas salvas. {notice.count} conta(s) vinculada(s) a este cliente.
            </div>
          )}
          {notice.kind === "discovered" && (
            <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-muted">
              {notice.count === 0
                ? "A Meta não retornou nenhuma conta para esta autorização."
                : `${notice.count} conta(s) disponível(is). Marque e clique em Salvar para vincular.`}
            </div>
          )}

          {discovering && accounts.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <Spinner className="size-4" />
              Carregando contas…
            </div>
          ) : accounts.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              {didDiscover
                ? "Nenhuma conta encontrada nesta autorização."
                : "Clique em “Buscar contas na Meta” para listar as contas disponíveis."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {accounts.map((acc) => {
                const checked = selected.has(acc.adAccountId);
                return (
                  <li key={acc.adAccountId} className="flex items-start gap-3 p-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-accent"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(acc.adAccountId)}
                      aria-label={`Selecionar ${acc.name ?? acc.adAccountId}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {acc.name ?? "(sem nome)"}
                        </span>
                        {acc.isLinked && (
                          <Badge tone="positive" dot>
                            Vinculada
                          </Badge>
                        )}
                        <Badge tone="muted">{accountStatusLabel(acc.accountStatus)}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                        <span className="font-mono">{acc.adAccountId}</span>
                        {acc.currency && <span>{acc.currency}</span>}
                        {acc.timezoneName && (
                          <span>
                            {acc.timezoneName}
                            {utcOffsetLabel(acc.timezoneName)
                              ? ` (${utcOffsetLabel(acc.timezoneName)})`
                              : ""}
                          </span>
                        )}
                        {acc.businessName && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3" />
                            {acc.businessName}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
