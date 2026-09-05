"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart-container";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import {
  topClientsChartHeight,
  truncateClientName,
} from "@/lib/meta/agency-chart";
import type { TopClientBySpend } from "@/lib/meta/agency-overview";

const ACCENT = "var(--bernal-accent)";
const AXIS_STYLE = { fontSize: 11, fill: "var(--bernal-muted)" } as const;

interface Row {
  name: string;
  fullName: string;
  spend: number;
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-xl">
      <p className="mb-0.5 font-medium text-foreground">{row.fullName}</p>
      <p className="tabular-nums text-muted">{formatCurrency(row.spend)}</p>
    </div>
  );
}

/**
 * "Investimento por cliente" — barra horizontal, Top 10 por spend (maior no
 * topo). Altura dinâmica (não estica com 1 cliente), largura reservada para o
 * nome, truncamento visual + nome completo no tooltip. Navegação individual
 * fica na tabela abaixo (1 clique).
 */
export function TopClientsChart({
  clients,
}: {
  clients: readonly TopClientBySpend[];
}) {
  // Recharts (layout vertical) desenha o 1º item embaixo -> inverte p/ o maior no topo.
  const data: Row[] = [...clients]
    .reverse()
    .map((c) => ({ name: truncateClientName(c.name), fullName: c.name, spend: c.spend }));

  return (
    <ChartContainer
      title="Investimento por cliente"
      subtitle="Top 10 clientes ativos, maior investimento primeiro"
      isEmpty={data.length === 0}
      height={topClientsChartHeight(data.length)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barCategoryGap={data.length <= 1 ? "45%" : "28%"}
        >
          <CartesianGrid stroke="var(--bernal-border)" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={formatCompactCurrency}
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={{ stroke: "var(--bernal-border)" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={168}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--bernal-border)", fillOpacity: 0.3 }}
            content={<BarTooltip />}
          />
          <Bar dataKey="spend" radius={[0, 3, 3, 0]} maxBarSize={28}>
            {data.map((row) => (
              <Cell key={row.fullName} fill={ACCENT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
