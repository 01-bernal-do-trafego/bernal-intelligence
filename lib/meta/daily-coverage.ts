/**
 * Cobertura temporal de `meta_insights_daily`. Módulo PURO.
 *
 * Um preset só pode ser declarado "disponível de verdade" no dashboard se
 * TODAS as datas do seu intervalo já estiverem sincronizadas em
 * `meta_insights_daily` — exceto o dia de HOJE, que pode ser parcial.
 *
 * `dailyHorizon` diz o intervalo MÍNIMO que a sincronização precisa cobrir
 * para que os 7 presets fiquem completos, sem buracos.
 */

import type { DateRange, PeriodPreset } from "@/lib/date-range";
import { eachDay } from "@/lib/date-range";
import { metaPresetRange } from "./date-preset";

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(base: string, n: number): string {
  const d = parseISO(base);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
function firstOfPrevMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const py = (m ?? 1) === 1 ? (y ?? 1970) - 1 : (y ?? 1970);
  const pm = (m ?? 1) === 1 ? 12 : (m ?? 1) - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

/**
 * Intervalo mínimo de `meta_insights_daily` para cobrir TODOS os presets.
 *   date_to   = hoje (fuso da conta)
 *   date_from = a menor data entre (hoje - 30) e (1º do mês anterior)
 * (o 1º do mês atual e `hoje - N` menores já ficam contidos nisso.)
 */
export function dailyHorizon(today: string): DateRange {
  const minus30 = addDays(today, -30);
  const prevMonth = firstOfPrevMonth(today);
  return { start: minus30 < prevMonth ? minus30 : prevMonth, end: today };
}

export type CoverageStatus = "complete" | "partial" | "empty";

export interface Coverage {
  status: CoverageStatus;
  /** todas as datas exigidas pelo intervalo (inclui hoje). */
  requiredDates: string[];
  /** datas exigidas que faltam — HOJE nunca conta como faltando. */
  missingDates: string[];
  /** o intervalo inclui hoje (dado pode ainda crescer -> parcial aceitável). */
  partialToday: boolean;
}

/** Cobertura de um intervalo arbitrário contra o conjunto de datas presentes. */
export function rangeCoverage(args: {
  range: DateRange;
  today: string;
  presentDates: ReadonlySet<string>;
}): Coverage {
  const required = eachDay(args.range);
  const checkDates = required.filter((d) => d !== args.today);
  const missingDates = checkDates.filter((d) => !args.presentDates.has(d));
  const presentRequired = required.filter((d) => args.presentDates.has(d)).length;
  const partialToday = required.includes(args.today);

  let status: CoverageStatus;
  if (checkDates.length === 0) {
    // intervalo é só "hoje"
    status = args.presentDates.has(args.today) ? "complete" : "empty";
  } else if (missingDates.length === 0) {
    status = "complete";
  } else if (presentRequired > 0) {
    status = "partial";
  } else {
    status = "empty";
  }

  return { status, requiredDates: required, missingDates, partialToday };
}

/** Cobertura de um preset (usa a semântica de datas da Meta). */
export function presetCoverage(args: {
  preset: PeriodPreset;
  today: string;
  presentDates: ReadonlySet<string>;
}): Coverage {
  return rangeCoverage({
    range: metaPresetRange(args.preset, args.today),
    today: args.today,
    presentDates: args.presentDates,
  });
}

/** Cobertura de todos os presets do dashboard. */
export function coverageByPreset(args: {
  presets: readonly PeriodPreset[];
  today: string;
  presentDates: ReadonlySet<string>;
}): Record<string, Coverage> {
  const out: Record<string, Coverage> = {};
  for (const preset of args.presets) {
    out[preset] = presetCoverage({
      preset,
      today: args.today,
      presentDates: args.presentDates,
    });
  }
  return out;
}
