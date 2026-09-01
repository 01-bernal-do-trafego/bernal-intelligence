import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Ícone decorativo à esquerda (ex.: lupa de busca). */
  leading?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, invalid = false, ...props },
  ref,
) {
  return (
    <div className="relative flex items-center">
      {leading && (
        <span className="pointer-events-none absolute left-3 flex text-muted [&_svg]:size-4">
          {leading}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-foreground",
          "placeholder:text-muted/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55",
          "disabled:cursor-not-allowed disabled:opacity-50",
          leading && "pl-9",
          invalid ? "border-negative" : "border-border",
          className,
        )}
        {...props}
      />
    </div>
  );
});
