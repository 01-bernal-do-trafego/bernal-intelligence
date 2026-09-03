import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { parsePeriod } from "@/lib/date-range";
import { zipSeries } from "@/lib/series";
import {
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import {
  CARD_METRIC_KEY,
  cardLabel,
  chartMetricEntry,
  enabledKeys,
} from "@/lib/dashboard-config";
import { getClientRecord } from "@/server/clients";
import { getMetaConnection } from "@/server/meta-connection";
import { getAutoSyncEnabled, getClientSyncHealth } from "@/server/meta-sync-health";
import { listMetaAdAccounts } from "@/server/meta-ad-accounts";
import {
  getClientDashboard,
  type DashboardMetric,
  type MetricKey,
} from "@/server/client-dashboard";
import { describeCallbackReason } from "@/lib/meta/oauth-errors";
import { metaIsUsable } from "@/lib/meta/connection-state";
import {
  ClientStatusBadge,
  MetaConnectionBadge,
} from "@/components/shared/status-badges";
import { ConnectMetaButton } from "@/components/clients/connect-meta-button";
import { ManageMetaConnection } from "@/components/clients/manage-meta-connection";
import { SyncMetaButton } from "@/components/clients/sync-meta-button";
import { EditClientButton } from "@/components/clients/edit-client-dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard, type MetricDelta } from "@/components/ui/metric-card";
import { ChartContainer } from "@/components/ui/chart-container";
import { Badge } from "@/components/ui/badge";
import { DashboardChart } from "@/components/charts/dashboard-chart";
import { CampaignsTable } from "@/components/client-dashboard/campaigns-table";
import { DashboardHeaderActions } from "@/components/client-dashboard/dashboard-header-actions";
import { DashboardScopeFilters } from "@/components/client-dashboard/dashboard-scope-filters";
import { SyncHealthLines } from "@/components/client-dashboard/sync-health-lines";

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

function metricDelta(
  metric: DashboardMetric,
  compare: boolean,
): MetricDelta | null {
  if (!compare) return null;
  return {
    changePct: metric.comparison.changePct,
    direction: metric.comparison.direction,
    sentiment: metric.comparison.sentiment,
  };
}

function metricValue(metric: DashboardMetric): string {
  if (!metric.available) return "—";
  const value = metric.comparison.current;
  switch (metric.format) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return formatPercent(value, 2);
    case "decimal":
      return formatDecimal(value);
    default:
      return formatNumber(value);
  }
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

  const compare = sp.compare === "1";
  const dashboard = await getClientDashboard({
    client,
    preset: parsePeriod(sp.period),
    compare,
    accountId: sp.account,
    campaignId: sp.campaign,
  });

  const { config, metrics, series, resultMetric } = dashboard;

  const cardKeys = enabledKeys(config.layout.cards);
  const enabledCharts = config.layout.charts.filter((c) => c.enabled);
  const columnKeys = enabledKeys(config.layout.tableColumns);

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
            <DashboardHeaderActions clientId={client.id} config={config} />
          </div>
        </div>
      </header>

      {dashboard.dataStatus === "real" && (
        <div className="flex flex-col gap-3 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-positive">Dados reais da Meta Ads</span>
            <SyncMetaButton clientId={client.id} />
          </div>
          <SyncHealthLines health={syncHealth} autoSyncEnabled={autoSyncEnabled} />
        </div>
      )}

      {dashboard.dataStatus === "awaiting_sync" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">
            Meta Ads conectada. Rode a primeira sincronização para ver os dados
            reais deste cliente.
          </span>
          <SyncMetaButton clientId={client.id} />
        </div>
      )}

      {dashboard.dataStatus === "no_meta" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>
            Este cliente <span className="text-foreground">não tem a Meta Ads
            conectada</span>. Conecte e sincronize para ver dados reais. Nenhum
            número demonstrativo é exibido.
          </p>
        </div>
      )}

      {dashboard.dataStatus === "demo" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>
            Modo demonstração (desenvolvimento). A configuração do dashboard é
            real; os <span className="text-foreground">valores são fictícios</span>.
          </p>
        </div>
      )}

      {dashboard.reachScopeNote && (
        <div className="rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted">
          {dashboard.reachScopeNote}
        </div>
      )}

      {(dashboard.dataStatus === "real" || dashboard.dataStatus === "demo") && (
        <>
          {dashboard.dataStatus === "real" &&
            dashboard.selectedCoverage &&
            dashboard.selectedCoverage.status !== "complete" && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>
                  {dashboard.selectedCoverage.status === "empty"
                    ? "Este período ainda não foi sincronizado no histórico diário."
                    : `Período incompleto: ${dashboard.selectedCoverage.missingDates.length} dia(s) sem dados no histórico diário` +
                      (dashboard.selectedCoverage.missingDates[0]
                        ? ` (a partir de ${dashboard.selectedCoverage.missingDates[0]})`
                        : "") +
                      "."}{" "}
                  {dashboard.totalsFromAggregate
                    ? "Os totais abaixo vêm do agregado da Meta (corretos); os gráficos mostram só os dias já sincronizados."
                    : "Totais e gráficos podem estar parciais. Rode “Sincronizar Meta”."}
                </p>
              </div>
            )}

          <div className="flex flex-col gap-3 border-y border-border py-4">
            {dashboard.dataStatus === "real" &&
              dashboard.range.start &&
              dashboard.range.end && (
                <p className="text-xs text-muted">
                  Período: {dashboard.range.start} → {dashboard.range.end}
                  {dashboard.selectedCoverage?.partialToday
                    ? " · hoje é parcial"
                    : ""}
                  {dashboard.periodicInterval &&
                  (dashboard.periodicInterval.from !== dashboard.range.start ||
                    dashboard.periodicInterval.to !== dashboard.range.end)
                    ? ` · agregado Meta: ${dashboard.periodicInterval.from} → ${dashboard.periodicInterval.to}`
                    : ""}
                </p>
              )}
            <Suspense fallback={<div className="h-10" />}>
              <DateRangePicker />
            </Suspense>
            <Suspense fallback={<div className="h-10" />}>
              <DashboardScopeFilters
                accounts={dashboard.accounts}
                campaigns={dashboard.campaigns}
                currentAccount={dashboard.filters.accountId}
                currentCampaign={dashboard.filters.campaignId}
              />
            </Suspense>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Performance
              </h2>
              {dashboard.mode === "demo" && (
                <Badge tone="muted">Dados demonstrativos</Badge>
              )}
            </div>
            {cardKeys.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum card selecionado no editor.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {cardKeys.map((key) => {
                  const metricKey = (CARD_METRIC_KEY[key] ?? key) as MetricKey;
                  const metric = metrics[metricKey];
                  if (!metric) return null;
                  return (
                    <MetricCard
                      key={key}
                      label={cardLabel(key, resultMetric)}
                      value={metricValue(metric)}
                      delta={metricDelta(metric, compare)}
                      hint={
                        !metric.available ? metric.unavailableReason : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>

          {enabledCharts.length > 0 && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {enabledCharts.map((chart) => {
                const entry = chartMetricEntry(chart.metric);
                const pair = entry?.seriesKey
                  ? series[entry.seriesKey]
                  : undefined;
                const behavior = entry?.usesResultMetricBehavior
                  ? resultMetric.behavior
                  : (entry?.behavior ?? "neutral");

                const metricKey = (CARD_METRIC_KEY[chart.metric] ??
                  chart.metric) as MetricKey;
                const metricState = metrics[metricKey];
                const realUnavailable =
                  dashboard.mode === "real" &&
                  (!entry ||
                    entry.requiresMeta ||
                    (metricState && !metricState.available));

                if (!entry || entry.requiresMeta || !pair || realUnavailable) {
                  return (
                    <ChartContainer
                      key={chart.id}
                      title={chart.title}
                      isEmpty
                      emptyMessage={
                        realUnavailable && metricState?.unavailableReason
                          ? metricState.unavailableReason
                          : "Métrica disponível após a integração com a Meta Ads."
                      }
                    >
                      <div />
                    </ChartContainer>
                  );
                }

                const isReachLike =
                  chart.metric === "reach" || chart.metric === "frequency";

                return (
                  <ChartContainer
                    key={chart.id}
                    title={chart.title}
                    isEmpty={pair.current.every((d) => d.value === 0)}
                  >
                    <DashboardChart
                      metric={chart.metric}
                      visualization={chart.visualization}
                      title={chart.title}
                      data={zipSeries(pair.current, pair.previous)}
                      comparisonBehavior={behavior}
                    />
                    {dashboard.mode === "real" && isReachLike && (
                      <p className="mt-2 text-[11px] text-muted">
                        Cada ponto é o {chart.metric === "reach" ? "alcance" : "a frequência"} daquele dia.
                        Não somável para o total do período.
                      </p>
                    )}
                    {dashboard.mode === "real" &&
                      dashboard.selectedCoverage &&
                      dashboard.selectedCoverage.status !== "complete" && (
                        <p className="mt-2 text-[11px] text-warning">
                          Gráfico incompleto:{" "}
                          {dashboard.selectedCoverage.missingDates.length} dia(s)
                          sem dados no período.
                        </p>
                      )}
                  </ChartContainer>
                );
              })}
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Campanhas</h2>
            <CampaignsTable
              rows={dashboard.campaignRows}
              resultMetric={resultMetric}
              columns={columnKeys}
              unavailableColumns={dashboard.unavailableMetricKeys}
            />
          </section>
        </>
      )}
    </div>
  );
}
