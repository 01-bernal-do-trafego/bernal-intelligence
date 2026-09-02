/**
 * Período da área de validação `/clients/[id]/meta-data`. Módulo PURO.
 *
 * ÚNICA fonte da verdade do período naquela tela: o mesmo `preset` derivado
 * aqui é usado para TUDO — leitura de `?period=`, estado do seletor
 * (`DateRangePicker` também chama `parsePeriod`), consulta dos agregados
 * (`period_key = preset`), título, conversões, métricas base e tabela de
 * campanhas. Não pode haver default divergente entre servidor e seletor.
 *
 * `fallback` é o intervalo do preset na semântica da Meta e no fuso da conta —
 * exibido como janela quando o preset ainda NÃO tem agregado sincronizado
 * (nunca cair no horizonte diário do run, que é ~30d e não corresponde ao
 * seletor).
 */

import { parsePeriod, type PeriodPreset } from "@/lib/date-range";
import { metaPresetRange, todayInOffset } from "@/lib/meta/date-preset";
import { utcOffsetMinutes } from "@/lib/meta/timezone";

export interface ValidationPeriod {
  preset: PeriodPreset;
  /** intervalo (inclusivo) do preset no fuso da conta — título/janela. */
  fallback: { start: string; end: string };
}

export function resolveValidationPeriod(
  periodInput: string | null | undefined,
  timezoneName: string | null | undefined,
  now: Date = new Date(),
): ValidationPeriod {
  const preset = parsePeriod(periodInput);
  const offsetMinutes = utcOffsetMinutes(timezoneName ?? "UTC", now) ?? 0;
  const today = todayInOffset(offsetMinutes, now);
  return { preset, fallback: metaPresetRange(preset, today) };
}
