import { ChartContainer } from "@/components/ui/chart-container";
import { TrendChart } from "@/components/charts/trend-chart";
import type { ZippedPoint } from "@/lib/series";
import type { TopClientBySpend } from "@/lib/meta/agency-overview";

/**
 * "Investimento por cliente" — barra horizontal, Top 10 por spend. Reaproveita
 * `TrendChart` (variant "horizontal_bar"); a categoria (nome do cliente) usa o
 * mesmo campo `date` do gráfico temporal — `formatShortDate`/`formatDate`
 * devolvem a string original quando ela não tem forma de data ISO, então o
 * rótulo aparece intacto.
 *
 * O componente Bar do Recharts não tem link nativo por categoria sem lógica
 * extra de eventos — navegar ao clicar na barra ficou fora da V1 (a tabela
 * operacional abaixo já cobre "abrir dashboard do cliente" com 1 clique).
 */
export function TopClientsChart({ clients }: { clients: readonly TopClientBySpend[] }) {
  // Recharts (layout vertical) desenha o 1º item embaixo -> inverte para o
  // maior investimento aparecer no topo.
  const data: ZippedPoint[] = [...clients]
    .reverse()
    .map((c) => ({ date: c.name, current: c.spend, previous: null }));

  return (
    <ChartContainer
      title="Investimento por cliente"
      subtitle="Top 10 clientes ativos, maior investimento primeiro"
      isEmpty={data.length === 0}
      height={Math.max(220, data.length * 36)}
    >
      <TrendChart data={data} variant="horizontal_bar" format="currency" seriesLabel="Investimento" />
    </ChartContainer>
  );
}
