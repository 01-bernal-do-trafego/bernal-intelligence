import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { parsePeriod } from "@/lib/date-range";
import { getClientRecord } from "@/server/clients";
import { getMetaConnection } from "@/server/meta-connection";
import { getAutoSyncEnabled, getClientSyncHealth } from "@/server/meta-sync-health";
import { listMetaAdAccounts } from "@/server/meta-ad-accounts";
import { getClientDashboard } from "@/server/client-dashboard";
import { getShareLinkState } from "@/server/share-link";
import { describeCallbackReason } from "@/lib/meta/oauth-errors";
import { metaIsUsable } from "@/lib/meta/connection-state";
import {
  ClientStatusBadge,
  MetaConnectionBadge,
} from "@/components/shared/status-badges";
import { ConnectMetaButton } from "@/components/clients/connect-meta-button";
import { ManageMetaConnection } from "@/components/clients/manage-meta-connection";
import { EditClientButton } from "@/components/clients/edit-client-dialog";
import { Badge } from "@/components/ui/badge";
import { DashboardContent } from "@/components/client-dashboard/dashboard-content";
import { DashboardHeaderActions } from "@/components/client-dashboard/dashboard-header-actions";

interface ClientDashboardPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    period?: string;
    compare?: string;
    account?: string;
    campaign?: string;
    created?: string;
    meta?: string;
    reason?: string;
  }>;
}

export async function generateMetadata({
  params,
}: ClientDashboardPageProps): Promise<Metadata> {
  const { id } = await params;
  const client = await getClientRecord(id);
  return { title: client ? client.name : "Cliente" };
}

export default async function ClientDashboardPage({
  params,
  searchParams,
}: ClientDashboardPageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const client = await getClientRecord(id);
  if (!client) notFound();

  const metaConnection = await getMetaConnection(client.id);
  const metaConnected = metaIsUsable(metaConnection.state);
  const metaAdAccounts = metaConnected ? await listMetaAdAccounts(client.id) : [];
  const linkedAdAccounts = metaAdAccounts.filter((a) => a.isLinked);
  const [syncHealth, autoSyncEnabled] = metaConnected
    ? await Promise.all([getClientSyncHealth(client.id), getAutoSyncEnabled()])
    : [null, false];
  const shareLink = await getShareLinkState(client.id);

  const compare = sp.compare === "1";
  const dashboard = await getClientDashboard({
    client,
    preset: parsePeriod(sp.period),
    compare,
    accountId: sp.account,
    campaignId: sp.campaign,
  });

  const { config } = dashboard;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Clientes
        </Link>

        {sp.created === "1" && (
          <div className="rounded-lg border border-positive/30 bg-positive/10 px-4 py-2 text-sm text-positive">
            Cliente cadastrado com sucesso.
          </div>
        )}

        {sp.meta === "connected" && (
          <div className="rounded-lg border border-positive/30 bg-positive/10 px-4 py-2 text-sm text-positive">
            Meta Ads conectada com sucesso.
          </div>
        )}

        {sp.meta === "error" && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-2 text-sm text-negative">
            {describeCallbackReason(sp.reason)}
          </div>
        )}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                {client.name}
              </h1>
              <ClientStatusBadge status={client.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>Meta Ads</span>
              <span aria-hidden>·</span>
              <MetaConnectionBadge state={metaConnection.state} />
              {metaConnected && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {linkedAdAccounts.length === 0
                      ? "nenhuma conta vinculada"
                      : `${linkedAdAccounts.length} conta(s) vinculada(s)`}
                  </span>
                </>
              )}
            </div>
            {linkedAdAccounts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {linkedAdAccounts.map((acc) => (
                  <Badge key={acc.adAccountId} tone="neutral">
                    {acc.name ?? acc.adAccountId}
                    <span className="ml-1 font-mono text-[10px] text-muted">
                      {acc.adAccountId}
                    </span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectMetaButton clientId={client.id} state={metaConnection.state} />
            {metaConnected && (
              <ManageMetaConnection
                clientId={client.id}
                initialAccounts={metaAdAccounts}
              />
            )}
            {metaConnected && linkedAdAccounts.length > 0 && (
              <>
                <Link
                  href={`/clients/${client.id}/meta-data`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-foreground transition-colors hover:border-muted/40"
                >
                  Validar sincronização
                </Link>
                <Link
                  href={`/clients/${client.id}/creatives`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-foreground transition-colors hover:border-muted/40"
                >
                  Criativos
                </Link>
              </>
            )}
            <EditClientButton client={client} />
            <DashboardHeaderActions
              clientId={client.id}
              config={config}
              shareLinkActive={shareLink.active}
            />
          </div>
        </div>
      </header>

      <DashboardContent
        clientId={client.id}
        dashboard={dashboard}
        compare={compare}
        syncHealth={syncHealth}
        autoSyncEnabled={autoSyncEnabled}
      />
    </div>
  );
}
