"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS, parsePeriod, type PeriodPreset } from "@/lib/date-range";
import { Select } from "./select";

interface DateRangePickerProps {
  className?: string;
  /** Preset assumido quando a URL não tem `?period=` (default: DEFAULT_PERIOD global). */
  defaultPeriod?: PeriodPreset;
}

/**
 * Filtro de período do produto. Não é um calendário: seleciona um preset
 * (Hoje, Ontem, Últimos N dias, Este mês, Mês anterior) e liga/desliga a
 * comparação com o período anterior.
 *
 * O estado vive na URL (`?period=...&compare=1`), de modo que o servidor
 * recalcula os dados a cada mudança. Deve ser usado dentro de <Suspense>.
 */
export function DateRangePicker({ className, defaultPeriod }: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const period = parsePeriod(searchParams.get("period"), defaultPeriod);
  const compare = searchParams.get("compare") === "1";

  const update = useCallback(
    (next: { period?: string; compare?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.period !== undefined) params.set("period", next.period);
      if (next.compare !== undefined) {
        if (next.compare) params.set("compare", "1");
        else params.delete("compare");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      <Select
        aria-label="Período"
        className="w-48"
        value={period}
        options={PERIOD_PRESETS}
        onChange={(e) => update({ period: e.target.value })}
      />
      <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => update({ compare: e.target.checked })}
          className="size-4 rounded border-border accent-accent"
        />
        Comparar com período anterior
      </label>
    </div>
  );
}
