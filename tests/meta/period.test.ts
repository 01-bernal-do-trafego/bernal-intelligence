import { describe, expect, it } from "vitest";
import {
  META_CUSTOM_PERIOD_KEY,
  META_PERIOD_KEYS,
  isMetaPeriodKey,
  metaPeriodKeyFor,
  metaPeriodLocator,
  resolveDashboardRange,
  resolvePeriodParam,
} from "@/lib/meta/period";
import { PERIOD_PRESETS } from "@/lib/date-range";
import { metaPresetRange, metaPreviousRange } from "@/lib/meta/date-preset";

describe("META_PERIOD_KEYS", () => {
  it("cobre todos os presets do seletor + custom", () => {
    for (const preset of PERIOD_PRESETS) {
      expect(META_PERIOD_KEYS).toContain(preset.value);
      expect(isMetaPeriodKey(preset.value)).toBe(true);
    }
    expect(META_PERIOD_KEYS).toContain(META_CUSTOM_PERIOD_KEY);
    expect(isMetaPeriodKey("custom")).toBe(true);
    expect(isMetaPeriodKey("nao_existe")).toBe(false);
    expect(isMetaPeriodKey(null)).toBe(false);
  });

  it("preset mantém a chave nomeada; intervalo livre vira custom", () => {
    expect(metaPeriodKeyFor("last_7d")).toBe("last_7d");
    expect(metaPeriodKeyFor({ range: { start: "2026-08-01", end: "2026-08-09" } })).toBe(
      "custom",
    );
  });

  it("locator carrega a chave + as datas absolutas do período", () => {
    expect(
      metaPeriodLocator("last_30d", { start: "2026-08-01", end: "2026-08-30" }),
    ).toEqual({
      periodKey: "last_30d",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-30",
    });
  });
});

describe("resolvePeriodParam — BUG 01 V1.1 (único parser de period/dateFrom/dateTo da URL)", () => {
  it("preset antigo continua igual: nenhuma mudança de comportamento sem dateFrom/dateTo", () => {
    expect(resolvePeriodParam("last_30d", undefined, undefined)).toEqual({
      preset: "last_30d",
      customRange: null,
    });
    expect(resolvePeriodParam(null, undefined, undefined)).toEqual({
      preset: "last_7d", // DEFAULT_PERIOD
      customRange: null,
    });
    expect(resolvePeriodParam("banana", undefined, undefined)).toEqual({
      preset: "last_7d",
      customRange: null,
    });
  });

  it("preset explícito + fallback custom da página (ex.: Agency Overview = last_30d)", () => {
    expect(resolvePeriodParam(undefined, undefined, undefined, "last_30d")).toEqual({
      preset: "last_30d",
      customRange: null,
    });
  });

  it("custom válido: preset='custom' + customRange preenchido", () => {
    expect(resolvePeriodParam("custom", "2025-05-14", "2025-06-30")).toEqual({
      preset: "custom",
      customRange: { start: "2025-05-14", end: "2025-06-30" },
    });
  });

  it("custom + range histórico atravessando vários meses (o caso real do bug)", () => {
    expect(resolvePeriodParam("custom", "2025-05-14", "2026-09-13")).toEqual({
      preset: "custom",
      customRange: { start: "2025-05-14", end: "2026-09-13" },
    });
  });

  it("custom sem dateFrom -> cai no fallback (preset padrão), nunca 'custom' com customRange null", () => {
    const out = resolvePeriodParam("custom", undefined, "2025-06-30");
    expect(out.preset).not.toBe("custom");
    expect(out.customRange).toBeNull();
  });

  it("custom sem dateTo -> cai no fallback", () => {
    const out = resolvePeriodParam("custom", "2025-05-14", undefined);
    expect(out.preset).not.toBe("custom");
    expect(out.customRange).toBeNull();
  });

  it("custom com dateFrom > dateTo -> cai no fallback (nunca propaga range invertido)", () => {
    const out = resolvePeriodParam("custom", "2026-09-13", "2025-05-14");
    expect(out.preset).not.toBe("custom");
    expect(out.customRange).toBeNull();
  });

  it("custom com formato inválido -> cai no fallback explícito da página", () => {
    const out = resolvePeriodParam("custom", "14/05/2025", "2025-06-30", "last_30d");
    expect(out).toEqual({ preset: "last_30d", customRange: null });
  });

  it("nunca confia sem validar: string arbitrária como period continua indo para parsePeriod (nunca vira custom)", () => {
    const out = resolvePeriodParam("qualquer-coisa", "2025-05-14", "2025-06-30");
    expect(out.preset).not.toBe("custom");
    expect(out.customRange).toBeNull();
  });
});

describe("resolveDashboardRange — BUG 01 V1.1 (preset/customRange -> DateRange concreto)", () => {
  const TODAY = "2026-09-24";

  it("preset nomeado: idêntico a metaPresetRange (comportamento antigo preservado)", () => {
    for (const preset of ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"] as const) {
      expect(resolveDashboardRange(preset, TODAY, null)).toEqual(metaPresetRange(preset, TODAY));
    }
  });

  it("custom: usa customRange diretamente, ignora `today`", () => {
    const customRange = { start: "2025-05-14", end: "2025-06-30" };
    expect(resolveDashboardRange("custom", TODAY, customRange)).toEqual(customRange);
  });

  it("custom sem customRange (chamador não validou) -> cai no preset padrão, nunca lança", () => {
    expect(resolveDashboardRange("custom", TODAY, null)).toEqual(
      metaPresetRange("last_7d", TODAY),
    );
    expect(resolveDashboardRange("custom", TODAY, undefined)).toEqual(
      metaPresetRange("last_7d", TODAY),
    );
  });

  it("PARIDADE: custom range com as MESMAS datas de last_30d produz o range IDÊNTICO ao preset last_30d", () => {
    const presetRange = metaPresetRange("last_30d", TODAY);
    const customRange = { start: presetRange.start, end: presetRange.end };

    const viaPreset = resolveDashboardRange("last_30d", TODAY, null);
    const viaCustom = resolveDashboardRange("custom", TODAY, customRange);

    expect(viaCustom).toEqual(viaPreset);
    // e o período anterior (comparação) também bate — downstream não
    // distingue mais preset de custom a partir daqui.
    expect(metaPreviousRange(viaCustom)).toEqual(metaPreviousRange(viaPreset));
  });
});
