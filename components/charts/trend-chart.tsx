"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCompactNumber, formatCurrency, formatNumber, formatShortDate } from "@/lib/format";
import type { ZippedPoint } from "@/lib/series";

export type TrendValueFormat = "currency" | "number";

interface TrendChartProps {
  data: ZippedPoint[];
  variant?: "area" | "line";
  /**
   * Como formatar os valores. String (não função) para poder ser passado de
   * um Server Component para este Client Component.
   */
  format: TrendValueFormat;
  /** Rótulo da série atual (ex.: "Investimento"). */
  seriesLabel: string;
}

const AXIS_FORMATTERS: Record<TrendValueFormat, (value: number) => string> = {
  currency: formatCompactCurrency,
  number: formatCompactNumber,
};

const TOOLTIP_FORMATTERS: Record<TrendValueFormat, (value: number) => string> = {
  currency: formatCurrency,
  number: formatNumber,
};

const AXIS_STYLE = { fontSize: 11, fill: "var(--bernal-muted)" } as const;
const ACCENT = "var(--bernal-accent)";
const MUTED = "var(--bernal-chart-3)";

function TrendTooltip({
  active,
  payload,
  label,
  formatValue,
  seriesLabel,
}: {
  active?: boolean;
  payload?: { dataKey: string | number; value: number }[];
  label?: string;
  formatValue: (value: number) => string;
  seriesLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === "current");
  const previous = payload.find((p) => p.dataKey === "previous");
  return (
    <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-foreground">
        {label ? formatShortDate(label) : ""}
      </p>
      {current && (
        <p className="text-foreground">
          {seriesLabel}: <span className="tabular-nums">{formatValue(current.value)}</span>
        </p>
      )}
      {previous && previous.value != null && (
        <p className="text-muted">
          Período anterior:{" "}
          <span className="tabular-nums">{formatValue(previous.value)}</span>
        </p>
      )}
    </div>
  );
}

export function TrendChart({
  data,
  variant = "area",
  format,
  seriesLabel,
}: TrendChartProps) {
  const hasPrevious = data.some((d) => d.previous != null);
  const axisFormat = AXIS_FORMATTERS[format];
  const tooltipFormat = TOOLTIP_FORMATTERS[format];

  const commonAxes = (
    <>
      <CartesianGrid stroke="var(--bernal-border)" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={formatShortDate}
        tick={AXIS_STYLE}
        tickLine={false}
        axisLine={{ stroke: "var(--bernal-border)" }}
        minTickGap={24}
      />
      <YAxis
        width={64}
        tickFormatter={axisFormat}
        tick={AXIS_STYLE}
        tickLine={false}
        axisLine={false}
      />
      <Tooltip
        cursor={{ stroke: "var(--bernal-border)" }}
        content={
          <TrendTooltip formatValue={tooltipFormat} seriesLabel={seriesLabel} />
        }
      />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {variant === "area" ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          {commonAxes}
          {hasPrevious && (
            <Area
              type="monotone"
              dataKey="previous"
              stroke={MUTED}
              strokeDasharray="4 4"
              fill="none"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          )}
          <Area
            type="monotone"
            dataKey="current"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#trendFill)"
            dot={false}
          />
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {commonAxes}
          {hasPrevious && (
            <Line
              type="monotone"
              dataKey="previous"
              stroke={MUTED}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="current"
            stroke={ACCENT}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
