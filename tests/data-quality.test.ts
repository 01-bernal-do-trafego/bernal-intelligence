/**
 * DATA FOUNDATION V2 — contrato DataQuality.
 * Garante que só produzimos estados com evidência real e que ausência != zero.
 */
import { describe, expect, it } from "vitest";
import {
  FUTURE_DATA_QUALITY_STATES,
  PRODUCED_DATA_QUALITY_STATES,
  emptyDataQuality,
  getDataQuality,
  resolveValuePresence,
  type DataQualityState,
} from "@/lib/data-quality";
import type { Coverage } from "@/lib/meta/daily-coverage";

const coverage = (over: Partial<Coverage> = {}): Coverage => ({
  status: "complete",
  requiredDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
  missingDates: [],
  partialToday: false,
  ...over,
});

const NOW = Date.parse("2026-09-10T12:00:00Z");

describe("estados produzidos nesta fase", () => {
  it("PRODUCED e FUTURE não se sobrepõem e cobrem o union", () => {
    const all = new Set<DataQualityState>([
      ...PRODUCED_DATA_QUALITY_STATES,
      ...FUTURE_DATA_QUALITY_STATES,
    ]);
    expect(all.size).toBe(
      PRODUCED_DATA_QUALITY_STATES.length + FUTURE_DATA_QUALITY_STATES.length,
    );
    // 13 estados no total
    expect(all.size).toBe(13);
    expect([...PRODUCED_DATA_QUALITY_STATES].sort()).toEqual(
      ["no_data", "ok", "partial", "stale"].sort(),
    );
  });

  it("getDataQuality NUNCA devolve um estado 'futuro'", () => {
    const inputs = [
      { hasRows: true, coverage: coverage(), health: { performanceStatus: "fresh" as const } },
      { hasRows: true, coverage: coverage({ status: "partial", missingDates: ["2026-09-02"] }), health: { performanceStatus: "fresh" as const } },
      { hasRows: true, coverage: coverage(), health: { performanceStatus: "stale" as const } },
      { hasRows: false, coverage: coverage({ status: "empty" }), health: null },
      { hasRows: true, coverage: null, health: null },
    ];
    for (const inp of inputs) {
      const dq = getDataQuality({ ...inp, now: NOW });
      expect(FUTURE_DATA_QUALITY_STATES).not.toContain(dq.state);
      expect(PRODUCED_DATA_QUALITY_STATES).toContain(dq.state);
    }
  });
});

describe("ok / partial / stale / no_data", () => {
  it("ok = tem linhas + cobertura completa + performance fresh", () => {
    const dq = getDataQuality({
      hasRows: true,
      coverage: coverage(),
      health: { performanceStatus: "fresh" },
      now: NOW,
    });
    expect(dq.state).toBe("ok");
    expect(dq.confidence).toBe("high");
    expect(dq.reasons).toEqual([]);
  });

  it("partial = cobertura com dias faltando (mesmo com sync fresh)", () => {
    const dq = getDataQuality({
      hasRows: true,
      coverage: coverage({ status: "partial", missingDates: ["2026-09-02"] }),
      health: { performanceStatus: "fresh" },
      now: NOW,
    });
    expect(dq.state).toBe("partial");
    expect(dq.reasons).toContain("coverage_partial");
    expect(dq.coverage.presentDays).toBe(2);
    expect(dq.coverage.missingDates).toEqual(["2026-09-02"]);
  });

  it("stale = cobertura completa mas performance stale", () => {
    const dq = getDataQuality({
      hasRows: true,
      coverage: coverage(),
      health: {
        performanceStatus: "stale",
        performanceSyncedAt: "2026-09-08T00:00:00Z",
      },
      now: NOW,
    });
    expect(dq.state).toBe("stale");
    expect(dq.reasons).toContain("freshness_stale");
    expect(dq.freshness.ageHours).toBeGreaterThan(8);
  });

  it("no_data = sem linhas", () => {
    const dq = getDataQuality({ hasRows: false, coverage: null, health: null, now: NOW });
    expect(dq.state).toBe("no_data");
    expect(dq.reasons).toContain("no_rows");
  });

  it("sem sync essencial-completo (performance 'never') + linhas -> stale, não ok", () => {
    const dq = getDataQuality({
      hasRows: true,
      coverage: coverage(),
      health: { performanceStatus: "never" },
      now: NOW,
    });
    expect(dq.state).toBe("stale");
    expect(dq.reasons).toContain("sync_incomplete");
  });
});

describe("DataQuality NÃO inventa estados sem evidência", () => {
  it("no_data nunca vira no_delivery", () => {
    const dq = getDataQuality({ hasRows: false, coverage: coverage({ status: "empty" }), health: null, now: NOW });
    expect(dq.state).toBe("no_data");
    expect(dq.state).not.toBe("no_delivery");
  });

  it("nunca produz rate_limited / tracking_suspect / not_consolidable / insufficient_sample / backfill_incomplete nesta fase", () => {
    const forbidden = [
      "rate_limited",
      "tracking_suspect",
      "not_consolidable",
      "insufficient_sample",
      "backfill_incomplete",
      "metric_not_available_in_period",
      "unconfirmed",
    ];
    // varre um espaço razoável de inputs
    for (const hasRows of [true, false]) {
      for (const status of ["complete", "partial", "empty"] as const) {
        for (const perf of ["fresh", "stale", "never"] as const) {
          const dq = getDataQuality({
            hasRows,
            coverage: coverage({ status, missingDates: status === "partial" ? ["2026-09-02"] : [] }),
            health: { performanceStatus: perf },
            now: NOW,
          });
          expect(forbidden, JSON.stringify({ hasRows, status, perf })).not.toContain(dq.state);
        }
      }
    }
  });
});

describe("zero real != ausência de dado", () => {
  it("resolveValuePresence distingue real_zero de no_data", () => {
    const ok = { state: "ok" as const };
    const nd = { state: "no_data" as const };
    expect(resolveValuePresence({ value: 0, dataQuality: ok })).toBe("real_zero");
    expect(resolveValuePresence({ value: 0, dataQuality: nd })).toBe("no_data");
    expect(resolveValuePresence({ value: null, dataQuality: nd })).toBe("no_data");
    expect(resolveValuePresence({ value: null, dataQuality: ok })).toBe("missing");
    expect(resolveValuePresence({ value: 12.5, dataQuality: ok })).toBe("value");
    expect(resolveValuePresence({ value: undefined, dataQuality: ok })).toBe("missing");
  });
});

describe("emptyDataQuality", () => {
  it("é um contrato neutro no_data", () => {
    const dq = emptyDataQuality();
    expect(dq.state).toBe("no_data");
    expect(dq.coverage.expectedDays).toBe(0);
    expect(dq.freshness.lastSyncAt).toBe(null);
  });
});
