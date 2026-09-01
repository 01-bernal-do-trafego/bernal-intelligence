import type { TimePoint } from "@/types/domain";

export interface ZippedPoint {
  date: string;
  current: number;
  previous: number | null;
}

/**
 * Alinha série atual e anterior por índice (mesmo comprimento) para consumo
 * direto pelos gráficos. A data exibida é sempre a do período atual.
 */
export function zipSeries(
  current: readonly TimePoint[],
  previous: readonly TimePoint[] | null,
): ZippedPoint[] {
  return current.map((point, index) => ({
    date: point.date,
    current: point.value,
    previous: previous ? (previous[index]?.value ?? null) : null,
  }));
}
