import { cn } from "@/lib/cn";

interface SkeletonProps {
  className?: string;
}

/** Bloco de carregamento. Combine vários para montar esqueletos de layout. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-elevated", className)}
    />
  );
}

/** Esqueleto de texto com N linhas. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
