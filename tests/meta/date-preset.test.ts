import { describe, expect, it } from "vitest";
import {
  META_DASHBOARD_PRESETS,
  metaPresetRange,
  metaPreviousRange,
  todayInOffset,
} from "@/lib/meta/date-preset";

// "hoje" fixo: 2026-09-15 (uma terça)
const TODAY = "2026-09-15";

describe("metaPresetRange — semântica da Meta", () => {
  it("today / yesterday", () => {
    expect(metaPresetRange("today", TODAY)).toEqual({ start: TODAY, end: TODAY });
    expect(metaPresetRange("yesterday", TODAY)).toEqual({
      start: "2026-09-14",
      end: "2026-09-14",
    });
  });

  it("last_7d = 7 dias SEM hoje (termina ontem)", () => {
    expect(metaPresetRange("last_7d", TODAY)).toEqual({
      start: "2026-09-08",
      end: "2026-09-14",
    });
  });

  it("last_14d / last_30d também excluem hoje", () => {
    expect(metaPresetRange("last_14d", TODAY)).toEqual({
      start: "2026-09-01",
      end: "2026-09-14",
    });
    expect(metaPresetRange("last_30d", TODAY)).toEqual({
      start: "2026-08-16",
      end: "2026-09-14",
    });
  });

  it("this_month = 1º do mês até hoje (inclui hoje)", () => {
    expect(metaPresetRange("this_month", TODAY)).toEqual({
      start: "2026-09-01",
      end: TODAY,
    });
  });

  it("last_month = mês anterior completo", () => {
    expect(metaPresetRange("last_month", TODAY)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    // vira do ano
    expect(metaPresetRange("last_month", "2026-01-10")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("cobre exatamente os 7 presets do dashboard", () => {
    expect(META_DASHBOARD_PRESETS).toEqual([
      "today",
      "yesterday",
      "last_7d",
      "last_14d",
      "last_30d",
      "this_month",
      "last_month",
    ]);
    for (const p of META_DASHBOARD_PRESETS) {
      const r = metaPresetRange(p, TODAY);
      expect(r.start <= r.end).toBe(true);
    }
  });
});

describe("metaPreviousRange", () => {
  it("período anterior de mesma duração, terminando 1 dia antes", () => {
    // last_7d = 08..14 (7 dias) -> anterior = 01..07
    expect(metaPreviousRange({ start: "2026-09-08", end: "2026-09-14" })).toEqual({
      start: "2026-09-01",
      end: "2026-09-07",
    });
  });
  it("um único dia", () => {
    expect(metaPreviousRange({ start: "2026-09-15", end: "2026-09-15" })).toEqual({
      start: "2026-09-14",
      end: "2026-09-14",
    });
  });
});

describe("todayInOffset", () => {
  it("aplica o offset do fuso da conta", () => {
    // 2026-09-15T02:00:00Z -> em UTC-03:00 ainda é 2026-09-14
    const at = new Date("2026-09-15T02:00:00Z");
    expect(todayInOffset(-180, at)).toBe("2026-09-14");
    expect(todayInOffset(0, at)).toBe("2026-09-15");
    // fuso +05:30
    expect(todayInOffset(330, at)).toBe("2026-09-15");
  });
});
