import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: readonly SelectOption[];
  invalid?: boolean;
}

/**
 * Select nativo estilizado — acessível por padrão e sem reimplementar
 * listbox. Suficiente para filtros e formulários desta fase.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, invalid = false, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full appearance-none rounded-lg border bg-surface pl-3 pr-9 text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid ? "border-negative" : "border-border",
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-surface-elevated">
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
});
