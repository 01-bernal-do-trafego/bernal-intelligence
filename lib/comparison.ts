/**
 * Comparação entre período atual e período anterior.
 */

export type MetricBehavior =
  | "higher_is_better"
  | "lower_is_better"
  | "neutral"
  | "contextual";

export type ChangeSentiment = "positive" | "negative" | "neutral";
export type ChangeDirection = "up" | "down" | "flat";

export interface Comparison {
  current: number;
  previous: number;
  /** Variação percentual. `null` quando não há base anterior (previous = 0). */
  changePct: number | null;
  direction: ChangeDirection;
  sentiment: ChangeSentiment;
}

/**
 * Variação percentual de `previous` para `current`.
 * Retorna `null` quando não é possível calcular (sem base ou valores inválidos).
 */
export function percentChange(current: number, previous: number): number | null {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function directionOf(current: number, previous: number): ChangeDirection {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

/**
 * Classifica a mudança de uma métrica considerando seu comportamento.
 * - `higher_is_better`: subir é positivo, cair é negativo.
 * - `lower_is_better`: cair é positivo, subir é negativo.
 * - `neutral` / `contextual`: sem julgamento automático (sentimento neutro).
 */
export function compareMetric(
  current: number,
  previous: number,
  behavior: MetricBehavior,
): Comparison {
  const direction = directionOf(current, previous);
  let sentiment: ChangeSentiment = "neutral";

  if (
    direction !== "flat" &&
    (behavior === "higher_is_better" || behavior === "lower_is_better")
  ) {
    const improved =
      behavior === "higher_is_better" ? direction === "up" : direction === "down";
    sentiment = improved ? "positive" : "negative";
  }

  return {
    current,
    previous,
    changePct: percentChange(current, previous),
    direction,
    sentiment,
  };
}
