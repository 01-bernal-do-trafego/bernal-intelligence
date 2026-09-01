import {
  DEFAULT_PERIOD,
  previousRange,
  resolvePeriod,
  type DateRange,
  type PeriodPreset,
} from "@/lib/date-range";
import { MOCK_TODAY } from "@/lib/mock/dataset";

export interface ResolvedPeriod {
  preset: PeriodPreset;
  compare: boolean;
  range: DateRange;
  previous: DateRange;
}

/**
 * Resolve o período pedido (via URL) para faixas concretas, ancoradas na
 * data mock. `previous` é sempre calculado — a UI decide se o exibe conforme
 * o toggle `compare`.
 */
export function resolveRequestedPeriod(
  preset: PeriodPreset = DEFAULT_PERIOD,
  compare = false,
): ResolvedPeriod {
  const range = resolvePeriod(preset, MOCK_TODAY);
  return { preset, compare, range, previous: previousRange(range) };
}
