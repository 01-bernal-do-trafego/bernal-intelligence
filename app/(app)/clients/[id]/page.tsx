import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { notFound } from "next/navigation";
import { parsePeriod } from "@/lib/date-range";
import { zipSeries } from "@/lib/series";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Comparison } from "@/lib/comparison";
import { getClientById } from "@/server/clients";
import { getClientDashboard } from "@/server/client-dashboard";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard, type MetricDelta } from "@/components/ui/metric-card";
import { ChartContainer } from "@/components/ui/chart-container";
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
  }>;
}

export async function generateMetadata({
  params,
}: ClientDashboardPageProps): Promise<Metadata> {
  const { id } = await params;
  const client = getClientById(id);
  return { title: client ? client.name : "Cliente" };
}

function delta(comparison: Comparison, compare: boolean): MetricDelta | null {
  if (!compare) return null;
  return {
    changePct: comparison.changePct,
    direction: comparison.direction,
    sentiment: comparison.sentiment,
  };
}

export default async function ClientDashboardPage({
  params,
  searchParams,
}: ClientDashboardPageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const compare = sp.compare === "1";
  const dashboard = getClientDashboard({
    clientId: id,
    preset: parsePeriod(sp.period),
    compare,
    accountId: sp.account,
    campaignId: sp.campaign,
  });

  if (!dashboard) notFound();

  const { client, kpis, series, resultMetric } = dashboard;

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

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted">
              <span>Meta Ads</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <RefreshCw className="size-3.5" />
                {dashboard.syncedLabel}
              </span>
            </div>
          </div>
          <DashboardHeaderActions />
        </div>
      </header>

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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Investimento"
          value={formatCurrency(kpis.spend.current)}
          delta={delta(kpis.spend, compare)}
        />
        <MetricCard
          label={resultMetric.resultLabel}
          value={formatNumber(kpis.results.current)}
          delta={delta(kpis.results, compare)}
        />
        <MetricCard
          label={resultMetric.costLabel}
          value={formatCurrency(kpis.costPerResult.current)}
          delta={delta(kpis.costPerResult, compare)}
        />
        <MetricCard
          label="Alcance"
          value={formatNumber(kpis.reach.current)}
          delta={delta(kpis.reach, compare)}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartContainer
          title={`${resultMetric.resultLabel} ao longo do tempo`}
          isEmpty={series.results.current.every((d) => d.value === 0)}
        >
          <TrendChart
            data={zipSeries(series.results.current, series.results.previous)}
            variant="area"
            seriesLabel={resultMetric.resultLabel}
            format="number"
            comparisonBehavior="higher_is_better"
          />
        </ChartContainer>

        <ChartContainer
          title="Investimento ao longo do tempo"
          isEmpty={series.spend.current.every((d) => d.value === 0)}
        >
          <TrendChart
            data={zipSeries(series.spend.current, series.spend.previous)}
            variant="area"
            seriesLabel="Investimento"
            format="currency"
          />
        </ChartContainer>

        <ChartContainer
          title={resultMetric.costLabel}
          className="xl:col-span-2"
          isEmpty={series.costPerResult.current.every((d) => d.value === 0)}
        >
          <TrendChart
            data={zipSeries(
              series.costPerResult.current,
              series.costPerResult.previous,
            )}
            variant="line"
            seriesLabel={resultMetric.costLabel}
            format="currency"
            comparisonBehavior="lower_is_better"
          />
        </ChartContainer>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">Campanhas</h2>
        <CampaignsTable
          rows={dashboard.campaignRows}
          resultMetric={resultMetric}
        />
      </section>
    </div>
  );
}
