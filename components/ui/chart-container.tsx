import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./skeleton";

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Altura da área do gráfico. */
  height?: number;
  loading?: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function ChartContainer({
  title,
  subtitle,
  actions,
  children,
  height = 280,
  loading = false,
  error = null,
  isEmpty = false,
  emptyMessage = "Sem dados no período selecionado.",
  className,
}: ChartContainerProps) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-surface p-4",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>

      <div style={{ height }} className="relative w-full">
        {loading ? (
          <Skeleton className="size-full" />
        ) : error ? (
          <div className="flex size-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-negative">
            {error}
          </div>
        ) : isEmpty ? (
          <div className="flex size-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
