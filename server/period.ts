import {
  DEFAULT_PERIOD,
  previousRange,
  resolvePeriod,
  type DateRange,
} from "@/lib/date-range";
import { MOCK_TODAY } from "@/lib/mock/dataset";
import type { MetaPeriodKey } from "@/lib/meta/period";

export interface ResolvedPeriod {
  preset: MetaPeriodKey;
  compare: boolean;
  range: DateRange;
  previous: DateRange;
}

/**
 * Resolve o período pedido (via URL) para faixas concretas, ancoradas na
 * data mock. `previous` é sempre calculado — a UI decide se o exibe conforme
 * o toggle `compare`.
 *
 * Modo demo (dev sem Supabase): `custom` usa `customRange` diretamente
 * (já validado por `resolvePeriodParam`); sem ele (chamador não validou),
 * cai no preset padrão — nunca inventa um range.
 */
export function resolveRequestedPeriod(
  preset: MetaPeriodKey = DEFAULT_PERIOD,
  compare = false,
  customRange?: DateRange | null,
): ResolvedPeriod {
  if (preset === "custom") {
    if (customRange) {
      return { preset, compare, range: customRange, previous: previousRange(customRange) };
    }
    const range = resolvePeriod(DEFAULT_PERIOD, MOCK_TODAY);
    return { preset: DEFAULT_PERIOD, compare, range, previous: previousRange(range) };
  }
  const range = resolvePeriod(preset, MOCK_TODAY);
  return { preset, compare, range, previous: previousRange(range) };
}
