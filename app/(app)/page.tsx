import { Suspense } from "react";
import type { Metadata } from "next";
import { parsePeriod } from "@/lib/date-range";
import { formatCurrencyOrDash, formatNumber, formatPercentOrDash } from "@/lib/format";
import { plural } from "@/lib/plural";
import { getAgencyOverview } from "@/server/agency-overview";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard } from "@/components/ui/metric-card";
import { HeaderStatus } from "@/components/agency/header-status";
import { ResultGroups } from "@/components/agency/result-groups";
import { DailySpendChart } from "@/components/agency/daily-spend-chart";
import { TopClientsChart } from "@/components/agency/top-clients-chart";
import { HealthSummary } from "@/components/agency/health-summary";
import { AgencyClientsTable } from "@/components/agency/clients-table";

export const metadata: Metadata = { title: "Visão geral" };

const AGENCY_OVERVIEW_DEFAULT_PERIOD = "last_30d" as const;

interface HomePageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const sp = await searchParams;
  const preset = parsePeriod(sp.period, AGENCY_OVERVIEW_DEFAULT_PERIOD);

  const overview = await getAgencyOverview(preset);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Visão geral</h1>
          <p className="mt-1 text-sm text-muted">
            Visão consolidada da operação de mídia paga.
          </p>
          <HeaderStatus
            lastUpdatedAt={overview.lastUpdatedAt}
            attentionCount={overview.health.attentionCount}
          />
        </div>
        <Suspense fallback={<div className="h-10" />}>
          <DateRangePicker
            defaultPeriod={AGENCY_OVERVIEW_DEFAULT_PERIOD}
            showCompare={false}
          />
        </Suspense>
      </header>

      {!overview.ok ? (
        <div className="rounded-xl border border-negative/30 bg-negative/5 p-6 text-sm text-negative">
          Não foi possível carregar a Visão geral agora. Tente novamente em instantes.
        </div>
      ) : overview.activeClientsCount === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted">
          Nenhum cliente ativo cadastrado ainda.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Clientes ativos"
              value={formatNumber(overview.activeClientsCount)}
              hint={`${overview.clientsWithMetaConnectedCount} com Meta conectada`}
            />
            <MetricCard
              label="Investimento gerenciado"
              value={formatCurrencyOrDash(overview.totals.spend)}
              hint={
                overview.coverage.withData < overview.coverage.total
                  ? `${overview.coverage.withData} de ${overview.coverage.total} ${plural(
                      overview.coverage.total,
                      "cliente",
                    )} com dados no período`
                  : "Soma das contas Meta vinculadas, período selecionado"
              }
            />
            <MetricCard
              label="Contas Meta"
              value={formatNumber(overview.linkedAccountsCount)}
              hint={`${overview.linkedAccountsCount} ${plural(
                overview.linkedAccountsCount,
                "conta",
              )} em ${overview.linkedAccountsClientCount} ${plural(
                overview.linkedAccountsClientCount,
                "cliente",
              )}`}
            />
            <MetricCard
              label="Saúde da operação"
              value={`${formatNumber(overview.health.fresh)} de ${formatNumber(
                overview.activeClientsCount,
              )} ${plural(overview.activeClientsCount, "cliente")} ${plural(
                overview.activeClientsCount,
                "atualizado",
              )}`}
              hint={
                overview.health.attentionCount > 0
                  ? `${overview.health.attentionCount} ${plural(
                      overview.health.attentionCount,
                      "cliente",
                    )} ${plural(
                      overview.health.attentionCount,
                      "precisa",
                      "precisam",
                    )} de atenção`
                  : "Toda a operação em dia"
              }
            />
          </section>

          <ResultGroups groups={overview.resultGroups} />

          <DailySpendChart series={overview.dailySpendSeries} />

          <TopClientsChart clients={overview.topClientsBySpend} />

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Saúde da operação</h2>
            <HealthSummary health={overview.health} />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Clientes</h2>
              <span className="text-xs text-muted">
                CTR agência: {formatPercentOrDash(overview.totals.ctr)} · CPC:{" "}
                {formatCurrencyOrDash(overview.totals.cpc)} · CPM:{" "}
                {formatCurrencyOrDash(overview.totals.cpm)}
              </span>
            </div>
            <AgencyClientsTable rows={overview.clients} />
          </section>

          {overview.hasMixedTimezones && (
            <p className="text-xs text-muted">
              Algumas contas usam outro fuso horário. Os totais de período dessas
              contas são calculados no calendário da agência (America/Sao_Paulo) —
              aproximação nas viradas de dia.
            </p>
          )}
        </>
      )}
    </div>
  );
}
