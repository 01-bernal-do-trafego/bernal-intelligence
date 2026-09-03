import { describe, expect, it } from "vitest";
import {
  ESSENTIAL_STAGES,
  aggregateBatchStatus,
  aggregateCreativesStatus,
  effectiveBatchKey,
  essentialStagesComplete,
  latestBatch,
  performanceStatus,
  performanceSyncedAt,
  type CreativeStagePerAccount,
  type SyncRunLite,
} from "@/lib/meta/sync-health";

const cre = (o: Partial<CreativeStagePerAccount>): CreativeStagePerAccount => ({
  present: true,
  upserted: 0,
  minimalOnly: 0,
  failed: 0,
  degraded: false,
  ...o,
});

describe("aggregateBatchStatus — última EXECUÇÃO do cliente (N contas)", () => {
  it("cliente 2 contas success -> success", () => {
    expect(aggregateBatchStatus(["success", "success"])).toBe("success");
  });
  it("success + error -> partial", () => {
    expect(aggregateBatchStatus(["success", "error"])).toBe("partial");
  });
  it("todas error -> failed", () => {
    expect(aggregateBatchStatus(["error", "error", "error"])).toBe("failed");
  });
  it("uma running -> running (prioridade)", () => {
    expect(aggregateBatchStatus(["success", "running", "error"])).toBe("running");
  });
  it("não depende da ORDEM em que as contas terminam", () => {
    expect(aggregateBatchStatus(["error", "success"])).toBe(
      aggregateBatchStatus(["success", "error"]),
    );
    expect(aggregateBatchStatus(["success", "partial", "error"])).toBe("partial");
    expect(aggregateBatchStatus(["error", "partial", "success"])).toBe("partial");
  });
  it("sem batch -> never", () => {
    expect(aggregateBatchStatus([])).toBe("never");
  });
});

describe("aggregateCreativesStatus — agregado entre contas do batch", () => {
  it("ok + partial -> partial", () => {
    expect(
      aggregateCreativesStatus([cre({ upserted: 10 }), cre({ upserted: 8, minimalOnly: 2 })]),
    ).toBe("partial");
  });
  it("ok + failed(0 salvos) -> partial (regra conservadora: outras contas salvaram)", () => {
    expect(
      aggregateCreativesStatus([cre({ upserted: 10 }), cre({ upserted: 0, failed: 5 })]),
    ).toBe("partial");
  });
  it("todas 0 salvos + failed -> failed", () => {
    expect(
      aggregateCreativesStatus([cre({ upserted: 0, failed: 3 }), cre({ upserted: 0, failed: 1 })]),
    ).toBe("failed");
  });
  it("todas ok -> ok", () => {
    expect(aggregateCreativesStatus([cre({ upserted: 5 }), cre({ upserted: 9 })])).toBe("ok");
  });
  it("nenhuma tinha stats.creatives -> unknown", () => {
    expect(aggregateCreativesStatus([cre({ present: false }), cre({ present: false })])).toBe(
      "unknown",
    );
  });
  it("incremental steady-state: known_skipped, upserted 0, sem erro -> ok", () => {
    expect(aggregateCreativesStatus([cre({ upserted: 0 })])).toBe("ok");
  });
  it("degraded=true numa conta -> partial", () => {
    expect(aggregateCreativesStatus([cre({ upserted: 5, degraded: true })])).toBe("partial");
  });
});

describe("performance freshness — separada do status do último run", () => {
  it("fresh se <= 8h; stale se > 8h; never se null", () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    expect(performanceStatus("2026-09-03T10:00:00Z", now)).toBe("fresh"); // 2h
    expect(performanceStatus("2026-09-03T03:00:00Z", now)).toBe("stale"); // 9h
    expect(performanceStatus(null, now)).toBe("never");
  });

  it("sync OK 10:00 + tentativa falha 12:00 -> ainda fresh às 12:01", () => {
    // a tentativa falha NÃO mexe em performance_synced_at
    const now = Date.parse("2026-09-03T12:01:00Z");
    const performanceSyncedAtValue = "2026-09-03T10:00:00Z"; // último válido
    expect(performanceStatus(performanceSyncedAtValue, now)).toBe("fresh");
    // e o last_sync_status separado reflete a falha:
    expect(aggregateBatchStatus(["error"])).toBe("failed");
  });

  it("cliente = conta mais atrasada; qualquer conta sem perf válida -> never", () => {
    expect(performanceSyncedAt(["2026-09-03T10:00:00Z", "2026-09-03T09:00:00Z"])).toBe(
      "2026-09-03T09:00:00Z",
    );
    expect(performanceSyncedAt(["2026-09-03T10:00:00Z", null])).toBeNull();
    expect(performanceSyncedAt([])).toBeNull();
  });

  // regressão: min() do Postgres ignora NULL -> guard explícito
  it("A success 10:00 + B NUNCA sincronizada -> client = never (não 10:00)", () => {
    const at = performanceSyncedAt(["2026-09-03T10:00:00Z", null]);
    expect(at).toBeNull();
    expect(performanceStatus(at, Date.parse("2026-09-03T11:00:00Z"))).toBe("never");
  });
  it("A success recente + B success mais ANTIGA -> usa B", () => {
    const at = performanceSyncedAt(["2026-09-03T11:30:00Z", "2026-09-03T02:00:00Z"]);
    expect(at).toBe("2026-09-03T02:00:00Z"); // a conta mais atrasada
    expect(performanceStatus(at, Date.parse("2026-09-03T12:00:00Z"))).toBe("stale"); // 10h
  });
  it("A + B ambas success recentes -> fresh", () => {
    const at = performanceSyncedAt(["2026-09-03T10:30:00Z", "2026-09-03T11:00:00Z"]);
    expect(at).toBe("2026-09-03T10:30:00Z");
    expect(performanceStatus(at, Date.parse("2026-09-03T12:00:00Z"))).toBe("fresh");
  });
});

describe("execução (batch) — inclui runs legados sem sync_batch_id", () => {
  const run = (o: Partial<SyncRunLite>): SyncRunLite => ({
    id: "r",
    syncBatchId: null,
    status: "success",
    startedAt: "2026-09-01T00:00:00Z",
    ...o,
  });

  it("run novo usa sync_batch_id; run legado usa o próprio id", () => {
    expect(effectiveBatchKey({ id: "r1", syncBatchId: "b1" })).toBe("b1");
    expect(effectiveBatchKey({ id: "r2", syncBatchId: null })).toBe("r2");
  });

  it("dois runs LEGADOS (batch NULL) NÃO formam um único batch", () => {
    const runs = [
      run({ id: "old1", startedAt: "2026-09-01T08:00:00Z", status: "error" }),
      run({ id: "old2", startedAt: "2026-09-02T08:00:00Z", status: "success" }),
    ];
    const b = latestBatch(runs);
    expect(b).toHaveLength(1); // só o mais recente
    expect(b[0].id).toBe("old2");
    expect(aggregateBatchStatus(b.map((r) => r.status))).toBe("success"); // não vira "never"/"partial"
  });

  it("o run histórico mais recente continua sendo a última sync", () => {
    const runs = [
      run({ id: "old1", startedAt: "2026-09-01T08:00:00Z", status: "success" }),
      run({ id: "old2", startedAt: "2026-09-02T08:00:00Z", status: "partial" }),
    ];
    expect(latestBatch(runs)[0].id).toBe("old2");
  });

  it("runs NOVOS com o mesmo sync_batch_id continuam agregados", () => {
    const runs = [
      run({ id: "n1", syncBatchId: "b9", startedAt: "2026-09-03T10:00:00Z", status: "success" }),
      run({ id: "n2", syncBatchId: "b9", startedAt: "2026-09-03T10:00:01Z", status: "error" }),
      run({ id: "old", startedAt: "2026-09-01T00:00:00Z", status: "success" }),
    ];
    const b = latestBatch(runs);
    expect(b.map((r) => r.id).sort()).toEqual(["n1", "n2"]);
    expect(aggregateBatchStatus(b.map((r) => r.status))).toBe("partial");
  });
});

describe("essentialStagesComplete — creatives/ad_creatives NÃO contam", () => {
  it("todos os essenciais done -> true", () => {
    expect(essentialStagesComplete([...ESSENTIAL_STAGES])).toBe(true);
  });
  it("faltando insights_periodic_ad -> false", () => {
    expect(
      essentialStagesComplete(ESSENTIAL_STAGES.filter((s) => s !== "insights_periodic_ad")),
    ).toBe(false);
  });
  it("essenciais done + creatives ausente -> true (creatives não é essencial)", () => {
    expect(essentialStagesComplete([...ESSENTIAL_STAGES, "ad_creatives"])).toBe(true);
    expect(ESSENTIAL_STAGES).not.toContain("creatives");
    expect(ESSENTIAL_STAGES).not.toContain("ad_creatives");
  });
});
