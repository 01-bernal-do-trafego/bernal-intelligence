import { cn } from "@/lib/cn";

interface SpinnerProps {
  className?: string;
  label?: string;
}

/** Loader da marca: anel com destaque em rosa Bernal. */
export function Spinner({ className, label = "Carregando" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-border border-t-accent",
        className,
      )}
    />
  );
}
