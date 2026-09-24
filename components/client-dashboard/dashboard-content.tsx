import { Suspense } from "react";
import { Info } from "lucide-react";
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
  dedupeResultDuplicates,
  enabledKeys,
} from "@/lib/dashboard-config";
import type { ClientDashboardData, DashboardMetric, MetricKey } from "@/server/client-dashboard";
import type { ClientSyncHealth } from "@/server/meta-sync-health";
import { coverageNote } from "@/lib/meta/daily-coverage";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetricCard, type MetricDelta } from "@/components/ui/metric-card";
import { ChartContainer } from "@/components/ui/chart-container";
import { Badge } from "@/components/ui/badge";
import { DashboardChart } from "@/components/charts/dashboard-chart";
import { CampaignsTable } from "@/components/client-dashboard/campaigns-table";
import { DashboardScopeFilters } from "@/components/client-dashboard/dashboard-scope-filters";
import { SyncHealthLines } from "@/components/client-dashboard/sync-health-lines";
import { SyncMetaButton } from "@/components/clients/sync-meta-button";

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

export interface DashboardContentProps {
  clientId: string;
  dashboard: ClientDashboardData;
  compare: boolean;
  /**
   * Modo somente-leitura (dashboard compartilhável, `/share/<token>`):
   * esconde qualquer controle administrativo — "Sincronizar Meta" e o
   * detalhamento de saúde de sincronização. Filtros de VISUALIZAÇÃO
   * (período, conta, campanha, comparação) continuam ativos — são só
   * navegação por querystring, nunca mutação.
   */
  readOnly?: boolean;
  /** Ignorado quando `readOnly` — o modo compartilhado nunca busca isto. */
  syncHealth?: ClientSyncHealth | null;
  autoSyncEnabled?: boolean;
}

/**
 * Conteúdo do dashboard de um cliente: banners de estado, filtros, cards,
 * gráficos e tabela de campanhas. Reaproveitado IDÊNTICO pela página
 * administrativa (`app/(app)/clients/[id]/page.tsx`) e pela página pública
 * compartilhável (`app/share/[token]/page.tsx`) — nenhuma métrica/gráfico é
 * recalculado ou duplicado; ambas recebem o MESMO `ClientDashboardData` de
 * `getClientDashboard`.
 */
export function DashboardContent({
  clientId,
  dashboard,
  compare,
  readOnly = false,
  syncHealth,
  autoSyncEnabled,
}: DashboardContentProps) {
  const { config, metrics, series, resultMetric } = dashboard;

  // FEATURE 02A: "Resultados"/"Custo por resultado" e a métrica CONCRETA
  // correspondente (ex.: result_metric=messaging_conversations_started ->
  // "Conversas iniciadas") nunca renderizam como 2 cards/colunas idênticos.
  // NORMALIZADO EM LEITURA aqui — configs antigas salvas com os dois
  // habilitados deixam de duplicar sem precisar de migration. Gráficos não
  // passam por este filtro: cada gráfico tem título próprio, escolhido
  // explicitamente pelo usuário — não há o mesmo risco de duplicata "muda".
  const cardKeys = dedupeResultDuplicates(
    enabledKeys(config.layout.cards),
    resultMetric.type,
  );
  const enabledCharts = config.layout.charts.filter((c) => c.enabled);
  const columnKeys = dedupeResultDuplicates(
    enabledKeys(config.layout.tableColumns),
    resultMetric.type,
  );

  return (
    <>
      {dashboard.dataStatus === "real" && (
        <div className="flex flex-col gap-3 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-positive">Dados reais da Meta Ads</span>
            {!readOnly && <SyncMetaButton clientId={clientId} />}
          </div>
          {!readOnly && (
            <SyncHealthLines health={syncHealth ?? null} autoSyncEnabled={autoSyncEnabled ?? false} />
          )}
        </div>
      )}

      {dashboard.dataStatus === "awaiting_sync" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">
            Meta Ads conectada. Rode a primeira sincronização para ver os dados
            reais deste cliente.
          </span>
          {!readOnly && <SyncMetaButton clientId={clientId} />}
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
                  {coverageNote(dashboard.selectedCoverage)}{" "}
                  {dashboard.totalsFromAggregate
                    ? "Os totais abaixo vêm do agregado da Meta."
                    : "Totais e gráficos consideram só os dias com dados registrados neste período."}
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
                          {coverageNote(dashboard.selectedCoverage)}
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
    </>
  );
}
