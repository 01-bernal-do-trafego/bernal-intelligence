import { Suspense } from "react";
import type { Metadata } from "next";
import { parsePeriod } from "@/lib/date-range";
import { zipSeries } from "@/lib/series";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Comparison } from "@/lib/comparison";
import { getPortfolioAlerts, getPortfolioOverview } from "@/server/portfolio";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard, type MetricDelta } from "@/components/ui/metric-card";
import { ChartContainer } from "@/components/ui/chart-container";
import { TrendChart } from "@/components/charts/trend-chart";
import { AttentionCard } from "@/components/portfolio/attention-card";
import { PortfolioClientsTable } from "@/components/portfolio/clients-table";

export const metadata: Metadata = { title: "Visão geral" };

interface HomePageProps {
  searchParams: Promise<{ period?: string; compare?: string }>;
}

function delta(comparison: Comparison, compare: boolean): MetricDelta | null {
  if (!compare) return null;
  return {
    changePct: comparison.changePct,
    direction: comparison.direction,
    sentiment: comparison.sentiment,
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const sp = await searchParams;
  const preset = parsePeriod(sp.period);
  const compare = sp.compare === "1";

  const overview = getPortfolioOverview(preset, compare);
  const alerts = getPortfolioAlerts();
  const { kpis } = overview;

  const spendData = zipSeries(
    overview.spendSeries.current,
    overview.spendSeries.previous,
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Visão geral</h1>
          <p className="mt-1 text-sm text-muted">
            Como está a carteira e onde é preciso prestar atenção.
          </p>
        </div>
        <Suspense fallback={<div className="h-10" />}>
          <DateRangePicker />
        </Suspense>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Clientes ativos"
          value={formatNumber(kpis.activeClients.current)}
          delta={delta(kpis.activeClients, compare)}
          hint="Com veiculação no período"
        />
        <MetricCard
          label="Investimento"
          value={formatCurrency(kpis.spend.current)}
          delta={delta(kpis.spend, compare)}
        />
        <MetricCard
          label="Resultados"
          value={formatNumber(kpis.results.current)}
          delta={delta(kpis.results, compare)}
        />
        <MetricCard
          label="Custo médio por resultado"
          value={formatCurrency(kpis.costPerResult.current)}
          delta={delta(kpis.costPerResult, compare)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Atenção hoje</h2>
          <p className="text-xs text-muted">
            Onde agir primeiro — riscos de custo, ritmo de orçamento e
            oportunidades.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {alerts.map((alert) => (
            <AttentionCard key={alert.id} alert={alert} />
          ))}
        </div>
      </section>

      <ChartContainer
        title="Investimento da carteira"
        subtitle="Soma diária de investimento de todos os clientes"
        isEmpty={spendData.every((d) => d.current === 0)}
      >
        <TrendChart
          data={spendData}
          variant="area"
          seriesLabel="Investimento"
          format="currency"
        />
      </ChartContainer>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Clientes</h2>
        <PortfolioClientsTable rows={overview.clients} />
      </section>
    </div>
  );
}
