/**
 * Períodos e faixas de datas.
 *
 * Toda a matemática de datas é feita em UTC sobre strings `YYYY-MM-DD`
 * (data pura, sem horário) para evitar desvios de fuso.
 */

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "this_month"
  | "last_month";

/** Faixa inclusiva: contém `start` e `end`. */
export interface DateRange {
  start: string;
  end: string;
}

export interface PeriodOption {
  value: PeriodPreset;
  label: string;
}

export const PERIOD_PRESETS: readonly PeriodOption[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
] as const;

export const DEFAULT_PERIOD: PeriodPreset = "last_7d";

const PRESET_VALUES = new Set<string>(PERIOD_PRESETS.map((p) => p.value));

export function isPeriodPreset(value: string | null | undefined): value is PeriodPreset {
  return value != null && PRESET_VALUES.has(value);
}

export function parsePeriod(value: string | null | undefined): PeriodPreset {
  return isPeriodPreset(value) ? value : DEFAULT_PERIOD;
}

export function periodLabel(preset: PeriodPreset): string {
  return PERIOD_PRESETS.find((p) => p.value === preset)?.label ?? preset;
}

/* ------------------------------------------------------------------ */
/* Helpers de data (UTC, data pura)                                    */
/* ------------------------------------------------------------------ */

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, amount: number): string {
  const date = parseISO(iso);
  date.setUTCDate(date.getUTCDate() + amount);
  return toISODate(date);
}

/** Nº de dias na faixa, contando os dois extremos. */
export function rangeLengthDays(range: DateRange): number {
  const diff = parseISO(range.end).getTime() - parseISO(range.start).getTime();
  return Math.round(diff / 86_400_000) + 1;
}

/** Lista de datas (YYYY-MM-DD) da faixa, em ordem crescente. */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  for (let cursor = range.start; cursor <= range.end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

export function isWithin(range: DateRange, iso: string): boolean {
  return iso >= range.start && iso <= range.end;
}

/* ------------------------------------------------------------------ */
/* Resolução de preset -> faixa                                        */
/* ------------------------------------------------------------------ */

/**
 * Converte um preset em faixa concreta, relativa a `reference` (hoje).
 * Faixas "últimos N dias" terminam em `reference` e o incluem.
 */
export function resolvePeriod(preset: PeriodPreset, reference: string): DateRange {
  const ref = parseISO(reference);
  const today = toISODate(ref);

  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case "last_7d":
      return { start: addDays(today, -6), end: today };
    case "last_14d":
      return { start: addDays(today, -13), end: today };
    case "last_30d":
      return { start: addDays(today, -29), end: today };
    case "this_month": {
      const start = toISODate(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)));
      return { start, end: today };
    }
    case "last_month": {
      const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { start: toISODate(start), end: toISODate(end) };
    }
  }
}

/**
 * Período imediatamente anterior, de mesma duração, terminando um dia
 * antes do início da faixa informada.
 */
export function previousRange(range: DateRange): DateRange {
  const length = rangeLengthDays(range);
  const end = addDays(range.start, -1);
  const start = addDays(end, -(length - 1));
  return { start, end };
}
