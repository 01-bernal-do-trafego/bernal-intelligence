"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS, addDays, parsePeriod, type PeriodPreset } from "@/lib/date-range";
import { META_CUSTOM_PERIOD_KEY } from "@/lib/meta/period";
import { Select, type SelectOption } from "./select";
import { Input } from "./input";

interface DateRangePickerProps {
  className?: string;
  /** Preset assumido quando a URL não tem `?period=` (default: DEFAULT_PERIOD global). */
  defaultPeriod?: PeriodPreset;
  /** Mostrar o checkbox "Comparar com período anterior" (default: true). */
  showCompare?: boolean;
}

const OPTIONS: readonly SelectOption[] = [
  ...PERIOD_PRESETS,
  { value: META_CUSTOM_PERIOD_KEY, label: "Período personalizado" },
];

/** Data local (fuso do browser) como `YYYY-MM-DD` — só para SUGERIR o range
 * inicial ao entrar em modo custom (o usuário pode editar livremente; a
 * validação/consulta real usa sempre a string literal do `<input>`, nunca
 * `Date`/UTC). Usar `toISODate` (UTC) aqui deslocaria o dia perto da meia-noite. */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Filtro de período do produto. Um preset (Hoje, Ontem, Últimos N dias, Este
 * mês, Mês anterior) OU "Período personalizado" (data inicial + data final
 * livres — alcança qualquer trecho do histórico sincronizado). Liga/desliga
 * também a comparação com o período anterior.
 *
 * O estado vive na URL (`?period=...&dateFrom=...&dateTo=...&compare=1`), de
 * modo que o servidor recalcula os dados a cada mudança — o mesmo contrato é
 * lido pela página administrativa e pelo dashboard compartilhado
 * (`resolvePeriodParam`, `lib/meta/period.ts`). Deve ser usado dentro de
 * <Suspense>.
 *
 * As datas exibidas vêm SEMPRE da URL (mesma fonte única de verdade que
 * `period`/`compare` já usavam) — sem `useEffect` de sincronização. Os dois
 * únicos estados locais (`pendingFrom`/`pendingTo`) só existem para segurar,
 * na tela, uma edição AINDA inválida (`from > to`) antes de o usuário
 * corrigir — nunca são a fonte da verdade depois que a navegação acontece.
 */
export function DateRangePicker({
  className,
  defaultPeriod,
  showCompare = true,
}: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const periodParam = searchParams.get("period");
  const isCustom = periodParam === META_CUSTOM_PERIOD_KEY;
  const period = isCustom ? META_CUSTOM_PERIOD_KEY : parsePeriod(periodParam, defaultPeriod);
  const compare = searchParams.get("compare") === "1";
  const urlDateFrom = searchParams.get("dateFrom") ?? "";
  const urlDateTo = searchParams.get("dateTo") ?? "";

  // Rascunho de uma edição em curso que ainda não é um range válido (ex.:
  // usuário mudou "data final" para antes de "data inicial") — só existe
  // enquanto isso for verdade; some assim que a navegação for disparada ou
  // o campo mudar para um valor coerente com a URL.
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const dateFrom = pending?.from ?? urlDateFrom;
  const dateTo = pending?.to ?? urlDateTo;

  function navigate(params: URLSearchParams) {
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function commitCustomRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", META_CUSTOM_PERIOD_KEY);
    params.set("dateFrom", from);
    params.set("dateTo", to);
    navigate(params);
  }

  function onPeriodChange(value: string) {
    if (value === META_CUSTOM_PERIOD_KEY) {
      // já em modo custom (dateFrom/dateTo validados pelo servidor) -> reaplica
      // os mesmos; senão, sugere os últimos 30 dias como ponto de partida
      // editável. NUNCA reaproveita dateFrom/dateTo "soltos" na URL quando o
      // período atual não é custom (poderiam estar em qualquer ordem).
      const from = (isCustom && dateFrom) || addDays(localISODate(new Date()), -29);
      const to = (isCustom && dateTo) || localISODate(new Date());
      if (from <= to) {
        setPending(null);
        commitCustomRange(from, to);
      } else {
        setPending({ from, to });
      }
      return;
    }
    setPending(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    params.delete("dateFrom");
    params.delete("dateTo");
    navigate(params);
  }

  function onDateChange(field: "dateFrom" | "dateTo", value: string) {
    const from = field === "dateFrom" ? value : dateFrom;
    const to = field === "dateTo" ? value : dateTo;
    // range incompleto/invertido: NÃO navega (cairia no fallback do
    // servidor) — só mantém o valor digitado na tela até ficar válido.
    if (!from || !to || from > to) {
      setPending({ from, to });
      return;
    }
    setPending(null);
    commitCustomRange(from, to);
  }

  function onCompareChange(checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.set("compare", "1");
    else params.delete("compare");
    navigate(params);
  }

  const rangeInvalid = isCustom && dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      <Select
        aria-label="Período"
        className="w-48"
        value={period}
        options={OPTIONS}
        onChange={(e) => onPeriodChange(e.target.value)}
      />
      {isCustom && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Data inicial"
            type="date"
            className="w-40"
            invalid={rangeInvalid}
            value={dateFrom}
            onChange={(e) => onDateChange("dateFrom", e.target.value)}
          />
          <span className="text-sm text-muted">até</span>
          <Input
            aria-label="Data final"
            type="date"
            className="w-40"
            invalid={rangeInvalid}
            value={dateTo}
            onChange={(e) => onDateChange("dateTo", e.target.value)}
          />
          {rangeInvalid && (
            <span className="text-xs text-negative">
              Data inicial não pode ser depois da data final.
            </span>
          )}
        </div>
      )}
      {showCompare && (
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => onCompareChange(e.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Comparar com período anterior
        </label>
      )}
    </div>
  );
}
