"use client";

import type { MetricBehavior } from "@/lib/comparison";
import {
  chartMetricEntry,
  type VisualizationType,
} from "@/lib/dashboard-config";
import type { ZippedPoint } from "@/lib/series";
import { TrendChart, type TrendVariant } from "./trend-chart";

const IMPLEMENTED_VARIANTS: readonly TrendVariant[] = [
  "line",
  "area",
  "bar",
  "horizontal_bar",
];

interface DashboardChartProps {
  /** Chave da métrica (CHART_METRIC_CATALOG), ex.: "spend". */
  metric: string;
  visualization: VisualizationType;
  title: string;
  data: ZippedPoint[];
  /** Comportamento para colorir a comparação (a página resolve "results"). */
  comparisonBehavior: MetricBehavior;
}

/**
 * Camada genérica de renderização de gráfico. Recebe métrica + visualização +
 * dados + título e decide o componente Recharts (via TrendChart). Um único
 * componente serve todas as métricas — sem duplicação por métrica.
 */
export function DashboardChart({
  metric,
  visualization,
  title,
  data,
  comparisonBehavior,
}: DashboardChartProps) {
  const entry = chartMetricEntry(metric);
  // FEATURE 02A: usa o `format` real da métrica (currency/number/percent/
  // decimal) — antes qualquer coisa que não fosse "currency" virava "number"
  // cru, mesmo CTR (%) ou ROAS/frequência (decimal).
  const format = entry?.format ?? "number";
  const variant: TrendVariant = IMPLEMENTED_VARIANTS.includes(
    visualization as TrendVariant,
  )
    ? (visualization as TrendVariant)
    : "area";

  return (
    <TrendChart
      data={data}
      variant={variant}
      format={format}
      seriesLabel={title}
      comparisonBehavior={comparisonBehavior}
    />
  );
}
