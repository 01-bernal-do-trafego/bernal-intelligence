import { AlertTriangle, Gauge, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PortfolioAlert, PortfolioAlertKind } from "@/types/domain";

const KIND: Record<
  PortfolioAlertKind,
  { icon: LucideIcon; accent: string; label: string }
> = {
  critical: { icon: AlertTriangle, accent: "text-negative", label: "Crítico" },
  warning: { icon: Gauge, accent: "text-warning", label: "Orçamento" },
  opportunity: { icon: TrendingUp, accent: "text-accent", label: "Oportunidade" },
};

export function AttentionCard({ alert }: { alert: PortfolioAlert }) {
  const { icon: Icon, accent, label } = KIND[alert.kind];
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", accent)} />
        <span className={cn("text-xs font-medium uppercase tracking-wide", accent)}>
          {label}
        </span>
        <span className="ml-auto text-xs text-muted">{alert.clientName}</span>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{alert.title}</h3>
      <p className="text-sm text-muted">{alert.description}</p>
    </article>
  );
}
