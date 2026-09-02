import { describe, expect, it } from "vitest";
import { resolveValidationPeriod } from "@/lib/meta/validation-period";
import { parsePeriod, DEFAULT_PERIOD } from "@/lib/date-range";
import { metaPresetRange } from "@/lib/meta/date-preset";

/**
 * BUG DO FILTRO DE PERÍODO EM /meta-data: o seletor mostrava "Últimos 7 dias"
 * mas título/números vinham de "Últimos 30 dias". A causa era um DEFAULT
 * divergente (servidor assumia `last_30d`, seletor `last_7d`) e o título caía
 * no horizonte diário do run (~30d) quando o preset não tinha agregado.
 *
 * Garantia: UM único `preset` derivado alimenta seletor, consulta
 * (`period_key = preset`), título, conversões, métricas base e campanhas.
 */

// 2026-06-15 12:00 UTC — America/Sao_Paulo = UTC−03:00, ainda dia 15.
const NOW = new Date("2026-06-15T12:00:00Z");
const TZ = "America/Sao_Paulo";

describe("resolveValidationPeriod — preset único para toda a tela", () => {
  it("sem ?period → MESMO default do DateRangePicker (last_7d), não last_30d", () => {
    expect(resolveValidationPeriod(undefined, TZ, NOW).preset).toBe(DEFAULT_PERIOD);
    expect(resolveValidationPeriod(null, TZ, NOW).preset).toBe("last_7d");
    // o seletor lê o mesmo valor pela mesma função
    expect(parsePeriod(undefined)).toBe(resolveValidationPeriod(undefined, TZ, NOW).preset);
  });

  it("?period inválido cai no default (igual ao seletor)", () => {
    expect(resolveValidationPeriod("mês_passado_errado", TZ, NOW).preset).toBe(
      DEFAULT_PERIOD,
    );
  });

  it("selecionar last_7d → título/janela = intervalo last_7d (no fuso da conta)", () => {
    const { preset, fallback } = resolveValidationPeriod("last_7d", TZ, NOW);
    expect(preset).toBe("last_7d");
    // hoje (São Paulo) = 2026-06-15 → ontem = 14 → 08..14
    expect(fallback).toEqual({ start: "2026-06-08", end: "2026-06-14" });
  });

  it("selecionar last_30d → título/janela = intervalo last_30d", () => {
    const { preset, fallback } = resolveValidationPeriod("last_30d", TZ, NOW);
    expect(preset).toBe("last_30d");
    expect(fallback).toEqual({ start: "2026-05-16", end: "2026-06-14" });
  });

  it("last_7d e last_30d produzem intervalos DIFERENTES (não colapsam)", () => {
    const a = resolveValidationPeriod("last_7d", TZ, NOW).fallback;
    const b = resolveValidationPeriod("last_30d", TZ, NOW).fallback;
    expect(a).not.toEqual(b);
  });

  it("o intervalo de fallback bate com metaPresetRange do mesmo preset/dia", () => {
    // mesmo cálculo que a consulta e a série usam.
    for (const preset of ["last_7d", "last_30d", "this_month"] as const) {
      const { fallback } = resolveValidationPeriod(preset, TZ, NOW);
      expect(fallback).toEqual(metaPresetRange(preset, "2026-06-15"));
    }
  });

  it("fuso ausente → UTC, sem quebrar", () => {
    const { preset, fallback } = resolveValidationPeriod("last_7d", null, NOW);
    expect(preset).toBe("last_7d");
    expect(fallback).toEqual({ start: "2026-06-08", end: "2026-06-14" });
  });

  it("o preset é o mesmo com e sem fuso (consulta usa `period_key = preset`)", () => {
    const raw = "last_30d";
    expect(resolveValidationPeriod(raw, null, NOW).preset).toBe(
      resolveValidationPeriod(raw, TZ, NOW).preset,
    );
  });
});
