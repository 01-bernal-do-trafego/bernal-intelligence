/**
 * Presets de período com a SEMÂNTICA DA META (Marketing API `date_preset`).
 * Módulo PURO.
 *
 * Diferença crítica para `lib/date-range.ts#resolvePeriod` (que ancora no mock
 * e inclui "hoje" nas janelas "últimos N dias"):
 *
 *   Meta: last_7d / last_14d / last_30d = últimos N dias SEM o dia de hoje.
 *   Meta: this_month = 1º do mês -> hoje (inclui hoje).
 *   Meta: last_month = mês anterior completo.
 *
 * Usar a mesma matemática aqui e na Edge Function garante que:
 *  - a soma das linhas de `meta_insights_daily` no intervalo, e
 *  - a linha de `meta_insights_periodic` daquele intervalo
 * cubram EXATAMENTE o mesmo período — e batam com o Ads Manager.
 */

import type { DateRange, PeriodPreset } from "@/lib/date-range";

/** Presets suportados no dashboard real (V1). "custom" fica para depois. */
export const META_DASHBOARD_PRESETS: readonly PeriodPreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
];

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(base: string, amount: number): string {
  const d = parseISO(base);
  d.setUTCDate(d.getUTCDate() + amount);
  return iso(d);
}

/**
 * Intervalo (inclusivo) de um preset, com a semântica da Meta, relativo a
 * `today` (YYYY-MM-DD, já no fuso da conta).
 */
export function metaPresetRange(preset: PeriodPreset, today: string): DateRange {
  const ref = parseISO(today);
  const y = addDays(today, -1); // ontem

  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday":
      return { start: y, end: y };
    case "last_7d":
      return { start: addDays(y, -6), end: y };
    case "last_14d":
      return { start: addDays(y, -13), end: y };
    case "last_30d":
      return { start: addDays(y, -29), end: y };
    case "this_month": {
      const start = iso(
        new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)),
      );
      return { start, end: today };
    }
    case "last_month": {
      const start = new Date(
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1),
      );
      const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
      return { start: iso(start), end: iso(end) };
    }
  }
}

/** Período imediatamente anterior, mesma duração, terminando 1 dia antes. */
export function metaPreviousRange(range: DateRange): DateRange {
  const lengthDays =
    Math.round(
      (parseISO(range.end).getTime() - parseISO(range.start).getTime()) /
        86_400_000,
    ) + 1;
  const end = addDays(range.start, -1);
  const start = addDays(end, -(lengthDays - 1));
  return { start, end };
}

/** "Hoje" no fuso da conta (offset em minutos, assinado). */
export function todayInOffset(offsetMinutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}
