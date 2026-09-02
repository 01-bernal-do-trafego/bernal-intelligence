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
  CHART_MAPPING,
  cardLabel,
  chartTitle,
  enabledKeys,
} from "@/lib/dashboard-config";
import { getClientRecord } from "@/server/clients";
import {
  getClientDashboard,
  type DashboardMetric,
  type MetricKey,
} from "@/server/client-dashboard";
import { ClientStatusBadge, MetaStatusBadge } from "@/components/shared/status-badges";
import { EditClientButton } from "@/components/clients/edit-client-dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard, type MetricDelta } from "@/components/ui/metric-card";
import { ChartContainer } from "@/components/ui/chart-container";
import { Badge } from "@/components/ui/badge";
import { TrendChart } from "@/components/charts/trend-chart";
import { CampaignsTable } from "@/components/client-dashboard/campaigns-table";
import { DashboardHeaderActions } from "@/components/client-dashboard/dashboard-header-actions";
import { DashboardScopeFilters } from "@/components/client-dashboard/dashboard-scope-filters";

interface ClientDashboardPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    period?: string;
    compare?: string;
    account?: string;
    campaign?: string;
    created?: string;
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
  const chartKeys = enabledKeys(config.layout.charts);
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

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                {client.name}
              </h1>
              <ClientStatusBadge status={client.status} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted">
              <span>Meta Ads</span>
              <span aria-hidden>·</span>
              <MetaStatusBadge status="not_connected" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EditClientButton client={client} />
            <DashboardHeaderActions clientId={client.id} config={config} />
          </div>
        </div>
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          A configuração deste dashboard (métrica, cards, gráficos e colunas) já
          é <span className="text-foreground">real e salva por cliente</span>. Os
          valores de performance ainda são{" "}
          <span className="text-foreground">demonstrativos</span> e serão
          substituídos pela integração com a Meta Ads.
        </p>
      </div>

      <div className="flex flex-col gap-3 border-y border-border py-4">
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
          <h2 className="text-base font-semibold text-foreground">Performance</h2>
          <Badge tone="muted">Dados demonstrativos</Badge>
        </div>
        {cardKeys.length === 0 ? (
          <p className="text-sm text-muted">Nenhum card selecionado no editor.</p>
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
                />
              );
            })}
          </div>
        )}
      </section>

      {chartKeys.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {chartKeys.map((key) => {
            const mapping = CHART_MAPPING[key];
            if (!mapping) return null;
            const pair = series[mapping.series];
            if (!pair) return null;
            const behavior = mapping.usesMetricBehavior
              ? resultMetric.behavior
              : mapping.behavior;
            return (
              <ChartContainer
                key={key}
                title={chartTitle(key, resultMetric)}
                isEmpty={pair.current.every((d) => d.value === 0)}
              >
                <TrendChart
                  data={zipSeries(pair.current, pair.previous)}
                  variant={key === "cost_per_result_over_time" ? "line" : "area"}
                  seriesLabel={chartTitle(key, resultMetric)}
                  format={mapping.format}
                  comparisonBehavior={behavior}
                />
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
        />
      </section>
    </div>
  );
}
