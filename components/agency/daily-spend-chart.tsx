import { ChartContainer } from "@/components/ui/chart-container";
import { TrendChart } from "@/components/charts/trend-chart";
import type { ZippedPoint } from "@/lib/series";

/**
 * "Investimento ao longo do tempo" — soma diária de `meta_insights_daily`
 * entre TODAS as contas elegíveis dos clientes ativos (granularidade dia;
 * total do período usa a fonte periódica/autoritativa em outro lugar).
 */
export function DailySpendChart({
  series,
}: {
  series: readonly { date: string; value: number }[];
}) {
  const data: ZippedPoint[] = series.map((p) => ({
    date: p.date,
    current: p.value,
    previous: null,
  }));

  return (
    <ChartContainer
      title="Investimento ao longo do tempo"
      subtitle="Soma diária de todas as contas Meta vinculadas aos clientes ativos"
      isEmpty={data.length === 0}
    >
      <TrendChart data={data} variant="area" format="currency" seriesLabel="Investimento" />
    </ChartContainer>
  );
}
