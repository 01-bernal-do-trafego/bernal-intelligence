import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChangeDirection, ChangeSentiment } from "@/lib/comparison";
import { formatSignedPercent } from "@/lib/format";
import { Skeleton } from "./skeleton";

export interface MetricDelta {
  changePct: number | null;
  direction: ChangeDirection;
  sentiment: ChangeSentiment;
}

interface MetricCardProps {
  label: string;
  value: string;
  delta?: MetricDelta | null;
  /** Texto auxiliar (ex.: valor absoluto do período anterior). */
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
}

const SENTIMENT_COLOR: Record<ChangeSentiment, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted",
};

function DeltaIcon({ direction }: { direction: ChangeDirection }) {
  if (direction === "up") return <ArrowUpRight className="size-3.5" />;
  if (direction === "down") return <ArrowDownRight className="size-3.5" />;
  return <Minus className="size-3.5" />;
}

export function MetricCard({
  label,
  value,
  delta,
  hint,
  icon,
  loading = false,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-9 w-32" />
      ) : (
        <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground sm:text-3xl">
          {value}
        </span>
      )}

      {loading ? (
        <Skeleton className="h-4 w-32" />
      ) : delta ? (
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums",
              SENTIMENT_COLOR[delta.sentiment],
            )}
          >
            <DeltaIcon direction={delta.direction} />
            {formatSignedPercent(delta.changePct)}
          </span>
          <span className="text-[11px] text-muted">vs. período anterior</span>
        </div>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  );
}
