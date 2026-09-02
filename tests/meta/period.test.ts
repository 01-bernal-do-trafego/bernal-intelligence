import { describe, expect, it } from "vitest";
import {
  META_CUSTOM_PERIOD_KEY,
  META_PERIOD_KEYS,
  isMetaPeriodKey,
  metaPeriodKeyFor,
  metaPeriodLocator,
} from "@/lib/meta/period";
import { PERIOD_PRESETS } from "@/lib/date-range";

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
