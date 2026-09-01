import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "positive"
  | "negative"
  | "warning"
  | "muted";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-elevated text-foreground border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  positive: "bg-positive/10 text-positive border-positive/30",
  negative: "bg-negative/10 text-negative border-negative/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  muted: "bg-transparent text-muted border-border",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  /** Ponto colorido à esquerda (útil para status). */
  dot?: boolean;
}

export function Badge({ children, tone = "neutral", className, dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
