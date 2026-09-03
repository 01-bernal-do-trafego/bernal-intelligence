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

export const metadata: Metadata = { title: "Validar criativos" };

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

  const { account, period, counts, rows, resultMetric } = overview;
  const currency = account?.currency ?? null;

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
          <h1 className="text-xl font-semibold text-foreground">Validar criativos</h1>
          <MetaConnectionBadge state={connection.state} />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          Área de <span className="text-foreground">administração</span>. A
          performance do criativo vem dos insights nível <span className="text-foreground">anúncio</span>,
          somada apenas nos dias em que a relação anúncio↔criativo é{" "}
          <span className="text-foreground">observacionalmente segura</span> (a Meta
          não fornece a cronologia de troca de criativo). A atribuição melhora a
          cada sincronização. Nada aqui altera o dashboard.
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
          sub={overview.periodSynced ? undefined : "sem insights nível anúncio no intervalo"}
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
            <h2 className="text-base font-semibold text-foreground">Criativos (dados reais)</h2>
            <p className="text-xs text-muted">
              Ordenação por critérios objetivos. `Resultados` = métrica configurada
              como resultado principal do cliente ({resultMetric.label}), resolvida
              em leitura. Alcance/frequência não são agregados por criativo. Compare
              manualmente com o Ads Manager antes de liberar no dashboard.
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
