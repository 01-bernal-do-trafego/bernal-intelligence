import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { periodLabel } from "@/lib/date-range";
import { getClientRecord } from "@/server/clients";
import { getMetaConnection } from "@/server/meta-connection";
import { getCreativeValidationOverview } from "@/server/meta-creatives-data";
import { MetaConnectionBadge } from "@/components/shared/status-badges";
import { SyncMetaButton } from "@/components/clients/sync-meta-button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DashboardScopeFilters } from "@/components/client-dashboard/dashboard-scope-filters";
import { CreativesTable } from "@/components/client-dashboard/creatives-table";

export const metadata: Metadata = { title: "Criativos" };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; account?: string; campaign?: string }>;
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function CreativesPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClientRecord(id);
  if (!client) notFound();

  const [connection, overview] = await Promise.all([
    getMetaConnection(client.id),
    getCreativeValidationOverview(client.id, {
      preset: sp.period,
      accountId: sp.account,
      campaignId: sp.campaign,
    }),
  ]);

  const { account, period, counts, rows, resultMetric, creativeSync } = overview;
  const currency = account?.currency ?? null;

  const creativeSyncBanner:
    | { tone: "warning" | "negative"; text: string }
    | null =
    creativeSync.status === "failed"
      ? {
          tone: "negative",
          text: "Os dados de performance foram atualizados, mas os criativos não. Clique em Sincronizar Meta novamente.",
        }
      : creativeSync.status === "degraded"
        ? {
            tone: "warning",
            text: "Os criativos foram atualizados parcialmente. Alguns podem estar sem imagem, texto ou detalhes até a próxima sincronização.",
          }
        : creativeSync.status === "unknown" && creativeSync.runStatus
          ? {
              tone: "warning",
              text: "A última sincronização não trouxe os criativos. Clique em Sincronizar Meta para atualizá-los.",
            }
          : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link
          href={`/clients/${client.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {client.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">Criativos</h1>
          <MetaConnectionBadge state={connection.state} />
        </div>
      </div>

      {creativeSyncBanner && (
        <div
          className={
            creativeSyncBanner.tone === "negative"
              ? "flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative"
              : "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
          }
        >
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>{creativeSyncBanner.text}</p>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          A performance de cada criativo é somada só nos dias em que dá para ter
          certeza de qual criativo o anúncio estava usando. Como a Meta não
          informa quando um criativo foi trocado, a atribuição fica mais
          completa a cada sincronização.
        </p>
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <DateRangePicker />
      </Suspense>
      {overview.accounts.length > 0 && (
        <Suspense fallback={<div className="h-10" />}>
          <DashboardScopeFilters
            accounts={overview.accounts.map((a) => ({
              id: a.id,
              clientId: client.id,
              name: a.name,
              externalId: a.id,
            }))}
            campaigns={overview.campaigns.map((c) => ({
              id: c.id,
              accountId: "",
              clientId: client.id,
              name: c.name,
              status: "active",
              objective: "conversions",
            }))}
            currentAccount={overview.filters.accountId}
            currentCampaign={overview.filters.campaignId}
          />
        </Suspense>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Conta" value={account?.name ?? account?.adAccountId ?? "—"} sub={account?.adAccountId} />
        <Field
          label={`Período · ${periodLabel(overview.preset)}`}
          value={period.start && period.end ? `${period.start} → ${period.end}` : "—"}
          sub={overview.periodSynced ? undefined : "sem dados de anúncios neste intervalo"}
        />
        <Field label="Resultado principal" value={resultMetric.label} />
        <Field
          label="Criativos"
          value={String(counts.creativesFound)}
          sub={`${counts.withPeriodPerformance} com performance no período`}
        />
      </div>

      <div>
        <SyncMetaButton clientId={client.id} />
      </div>

      {!overview.hasData ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          Nenhum criativo sincronizado. Clique em{" "}
          <span className="text-foreground">Sincronizar Meta</span>.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-foreground">Contagem</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ["Encontrados", counts.creativesFound],
                ["Com imagem", counts.withImage],
                ["Com vídeo", counts.withVideo],
                ["Dinâmicos", counts.dynamic],
                ["Com performance", counts.withPeriodPerformance],
                ["Atrib. observada", counts.attributionComplete],
                ["Atrib. parcial", counts.attributionPartial],
                ["Não confirmada", counts.attributionUnconfirmed],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <div className="text-xs text-muted">{label}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Criativos</h2>
            <p className="text-xs text-muted">
              &quot;Resultados&quot; usa o resultado principal do cliente
              ({resultMetric.label}). Alcance e frequência não são somados por
              criativo.
            </p>
            <CreativesTable
              rows={rows}
              currency={currency}
              resultLabel={resultMetric.label}
              costLabel={resultMetric.costLabel}
            />
          </section>
        </>
      )}
    </div>
  );
}
