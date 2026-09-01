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
import { compareMetric, type MetricBehavior } from "@/lib/comparison";
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatNumber,
  formatShortDate,
  formatSignedPercent,
} from "@/lib/format";
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
  /**
   * Comportamento da métrica — usado só para colorir a variação no tooltip
   * quando há comparação. `neutral` não recebe cor.
   */
  comparisonBehavior?: MetricBehavior;
}

const AXIS_FORMATTERS: Record<TrendValueFormat, (value: number) => string> = {
  currency: formatCompactCurrency,
  number: formatCompactNumber,
};

const TOOLTIP_FORMATTERS: Record<TrendValueFormat, (value: number) => string> = {
  currency: formatCurrency,
  number: formatNumber,
};

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted",
};

const AXIS_STYLE = { fontSize: 11, fill: "var(--bernal-muted)" } as const;
const ACCENT = "var(--bernal-accent)";
const MUTED = "var(--bernal-chart-3)";

interface TooltipPayloadItem {
  dataKey: string | number;
  value: number | null;
}

function TrendTooltip({
  active,
  payload,
  label,
  formatValue,
  seriesLabel,
  behavior,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  formatValue: (value: number) => string;
  seriesLabel: string;
  behavior: MetricBehavior;
}) {
  if (!active || !payload?.length) return null;

  const current = payload.find((p) => p.dataKey === "current")?.value ?? null;
  const previous = payload.find((p) => p.dataKey === "previous")?.value ?? null;
  const showComparison = previous !== null;

  const change =
    showComparison && current !== null
      ? compareMetric(current, previous, behavior)
      : null;

  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-foreground">
        {label ? formatDate(label) : ""}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="size-2 rounded-full" style={{ background: ACCENT }} />
          {seriesLabel}
        </span>
        <span className="tabular-nums text-foreground">
          {current !== null ? formatValue(current) : "—"}
        </span>
      </div>
      {showComparison && (
        <div className="mt-1 flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span
              className="size-2 rounded-full border border-dashed"
              style={{ borderColor: MUTED }}
            />
            Período anterior
          </span>
          <span className="tabular-nums text-muted">{formatValue(previous)}</span>
        </div>
      )}
      {change && change.changePct !== null && (
        <p
          className={`mt-1.5 border-t border-border pt-1.5 font-medium tabular-nums ${
            SENTIMENT_COLOR[change.sentiment] ?? "text-muted"
          }`}
        >
          {formatSignedPercent(change.changePct)} vs. anterior
        </p>
      )}
    </div>
  );
}

function LegendRow({ seriesLabel }: { seriesLabel: string }) {
  return (
    <div className="flex items-center gap-4 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full" style={{ background: ACCENT }} />
        {seriesLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-0 w-4 border-t border-dashed"
          style={{ borderColor: MUTED }}
        />
        Período anterior
      </span>
    </div>
  );
}

export function TrendChart({
  data,
  variant = "area",
  format,
  seriesLabel,
  comparisonBehavior = "neutral",
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
        minTickGap={32}
        padding={{ left: 4, right: 4 }}
      />
      <YAxis
        width={52}
        tickFormatter={axisFormat}
        tick={AXIS_STYLE}
        tickLine={false}
        axisLine={false}
        tickCount={5}
      />
      <Tooltip
        cursor={{ stroke: "var(--bernal-border)" }}
        content={
          <TrendTooltip
            formatValue={tooltipFormat}
            seriesLabel={seriesLabel}
            behavior={comparisonBehavior}
          />
        }
      />
    </>
  );

  return (
    <div className="flex size-full flex-col gap-2">
      {hasPrevious && <LegendRow seriesLabel={seriesLabel} />}
      <div className="min-h-0 flex-1">
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
                  isAnimationActive={false}
                />
              )}
              <Area
                type="monotone"
                dataKey="current"
                stroke={ACCENT}
                strokeWidth={2}
                fill="url(#trendFill)"
                dot={false}
                activeDot={{ r: 3, fill: ACCENT }}
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
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="current"
                stroke={ACCENT}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: ACCENT }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
