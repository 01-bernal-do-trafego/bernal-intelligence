import { describe, expect, it } from "vitest";
import {
  accumulatePage,
  buildSyncStats,
  newPageAccumulator,
  resolveSyncStatus,
  type StageResult,
} from "@/lib/meta/sync-plan";

const stage = (
  s: StageResult["stage"],
  outcome: StageResult["outcome"],
  rows = 0,
  pages = 1,
): StageResult => ({ stage: s, outcome, rows, pages });

describe("resolveSyncStatus", () => {
  it("tudo done => success", () => {
    expect(
      resolveSyncStatus([
        stage("campaigns", "done", 3),
        stage("insights_daily_account", "done", 30),
        stage("insights_periodic_account", "done", 1),
      ]),
    ).toBe("success");
  });

  it("algo gravado + algo com erro/pulado => partial", () => {
    expect(
      resolveSyncStatus([
        stage("campaigns", "done", 3),
        stage("insights_daily_ad", "error"),
      ]),
    ).toBe("partial");
    expect(
      resolveSyncStatus([
        stage("campaigns", "done", 3),
        stage("insights_daily_ad", "skipped"),
      ]),
    ).toBe("partial");
  });

  it("nada gravado => error (ex.: sync simultânea abortada)", () => {
    expect(resolveSyncStatus([])).toBe("error");
    expect(resolveSyncStatus([stage("campaigns", "error")])).toBe("error");
  });

  it("fatal (token revogado) => error mesmo com etapas done", () => {
    expect(
      resolveSyncStatus([stage("campaigns", "done", 3)], true),
    ).toBe("error");
  });
});

describe("buildSyncStats", () => {
  it("consolida contagens e listas de etapas", () => {
    const stats = buildSyncStats([
      stage("campaigns", "done", 4, 1),
      stage("adsets", "done", 12, 1),
      stage("ads", "done", 40, 2),
      stage("insights_daily_account", "done", 30, 1),
      stage("insights_daily_ad", "error", 0, 3),
      stage("insights_periodic_account", "done", 1, 1),
    ]);
    expect(stats).toMatchObject({
      status: "partial",
      campaigns: 4,
      adsets: 12,
      ads: 40,
      insightsDaily: 30,
      insightsPeriodic: 1,
      stagesErrored: ["insights_daily_ad"],
      pages: 9,
    });
    expect(stats.stagesDone).toContain("campaigns");
  });
});

describe("accumulatePage — paginação por cursor", () => {
  it("continua enquanto vier nextAfter", () => {
    const acc = newPageAccumulator<number>();
    let r = accumulatePage(acc, { data: [1, 2], nextAfter: "c1" });
    expect(r.acc.done).toBe(false);
    expect(r.nextAfter).toBe("c1");
    r = accumulatePage(r.acc, { data: [3], nextAfter: null });
    expect(r.acc.done).toBe(true);
    expect(r.acc.items).toEqual([1, 2, 3]);
    expect(r.acc.pages).toBe(2);
    expect(r.acc.overflow).toBe(false);
  });

  it("uma página só (poucas contas/campanhas)", () => {
    const r = accumulatePage(newPageAccumulator<string>(), {
      data: ["a", "b"],
      nextAfter: null,
    });
    expect(r.acc).toMatchObject({ items: ["a", "b"], pages: 1, done: true });
  });

  it("estoura maxPages => done + overflow (nível será pulado)", () => {
    let acc = newPageAccumulator<number>();
    let next: string | null = "x";
    let pages = 0;
    while (next && pages < 10) {
      const r = accumulatePage(acc, { data: [pages], nextAfter: "x" }, 3);
      acc = r.acc;
      next = r.nextAfter;
      pages += 1;
    }
    expect(acc.overflow).toBe(true);
    expect(acc.done).toBe(true);
    expect(acc.pages).toBe(3);
  });
});
