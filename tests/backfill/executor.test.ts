import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { executeBackfillSegment, type BackfillExecutorDeps, type BackfillSegmentTask } from "@/lib/backfill/executor";

const TASK: BackfillSegmentTask = {
  id: "seg-1",
  jobId: "job-1",
  clientId: "client-1",
  adAccountRef: "aa-1",
  adAccountId: "act_123",
  level: "ad",
  dateFrom: "2026-08-01",
  dateTo: "2026-08-07",
  leaseToken: "token-current",
};

function baseDeps(overrides: Partial<BackfillExecutorDeps> = {}): BackfillExecutorDeps {
  return {
    isAccountLinked: vi.fn().mockResolvedValue(true),
    canRunBackfill: vi.fn().mockResolvedValue(true),
    fetchInsights: vi.fn().mockResolvedValue({ rows: [], pages: 1 }),
    upsertDaily: vi.fn().mockResolvedValue({ rowsWritten: 0 }),
    completeSegment: vi.fn().mockResolvedValue(true),
    failSegment: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("16. conta unlinked não executa", () => {
  it("recusa antes de checar rate budget ou buscar dados", async () => {
    const deps = baseDeps({ isAccountLinked: vi.fn().mockResolvedValue(false) });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "refused", reason: "not_linked" });
    expect(deps.canRunBackfill).not.toHaveBeenCalled();
    expect(deps.fetchInsights).not.toHaveBeenCalled();
  });
});

describe("rate limit — recusa antes de chamar fetchInsights", () => {
  it("canRunBackfill=false -> refused rate_limited, sem fetch", async () => {
    const deps = baseDeps({ canRunBackfill: vi.fn().mockResolvedValue(false) });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "refused", reason: "rate_limited" });
    expect(deps.fetchInsights).not.toHaveBeenCalled();
  });
});

describe("caminho de sucesso — com linhas", () => {
  it("busca, faz upsert e completa com outcome done", async () => {
    const row = { entity_id: "act_123" } as never;
    const deps = baseDeps({
      fetchInsights: vi.fn().mockResolvedValue({ rows: [row], pages: 2 }),
      upsertDaily: vi.fn().mockResolvedValue({ rowsWritten: 7 }),
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "completed", rowsWritten: 7 });
    expect(deps.upsertDaily).toHaveBeenCalledWith([row]);
    expect(deps.completeSegment).toHaveBeenCalledWith({
      segmentId: "seg-1",
      leaseToken: "token-current",
      rowsWritten: 7,
      pagesFetched: 2,
      outcome: "done",
    });
  });
});

describe("caminho de sucesso — sem linhas (skipped_no_data)", () => {
  it("não chama upsertDaily; completa com outcome skipped_no_data", async () => {
    const deps = baseDeps({ fetchInsights: vi.fn().mockResolvedValue({ rows: [], pages: 1 }) });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "skipped_no_data" });
    expect(deps.upsertDaily).not.toHaveBeenCalled();
    expect(deps.completeSegment).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped_no_data", rowsWritten: 0 }),
    );
  });
});

describe("12/10. token ATUAL finaliza com sucesso", () => {
  it("completeSegment devolvendo true -> outcome completed é reportado", async () => {
    const deps = baseDeps({
      fetchInsights: vi.fn().mockResolvedValue({ rows: [{} as never], pages: 1 }),
      completeSegment: vi.fn().mockResolvedValue(true),
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out.kind).toBe("completed");
  });
});

describe("10. stale lease token NÃO finaliza (fencing)", () => {
  it("completeSegment devolvendo false -> refused ownership_lost, NÃO completed", async () => {
    const deps = baseDeps({
      fetchInsights: vi.fn().mockResolvedValue({ rows: [{} as never], pages: 1 }),
      completeSegment: vi.fn().mockResolvedValue(false), // outro worker já reivindicou
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost" });
  });

  it("idem para o caminho skipped_no_data", async () => {
    const deps = baseDeps({
      fetchInsights: vi.fn().mockResolvedValue({ rows: [], pages: 1 }),
      completeSegment: vi.fn().mockResolvedValue(false),
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost" });
  });
});

describe("12. failure respeita fencing", () => {
  it("fetchInsights lança -> chama failSegment; token atual -> failed reportado", async () => {
    const deps = baseDeps({
      fetchInsights: vi.fn().mockRejectedValue(new Error("graph_timeout")),
      failSegment: vi.fn().mockResolvedValue(true),
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "failed", reason: "graph_timeout" });
    expect(deps.failSegment).toHaveBeenCalledWith({
      segmentId: "seg-1",
      leaseToken: "token-current",
      errorCode: "graph_timeout",
    });
  });

  it("fetchInsights lança + stale token -> failSegment devolve false -> ownership_lost, NÃO failed", async () => {
    const deps = baseDeps({
      fetchInsights: vi.fn().mockRejectedValue(new Error("graph_timeout")),
      failSegment: vi.fn().mockResolvedValue(false), // posse já perdida
    });
    const out = await executeBackfillSegment(TASK, deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost" });
  });
});

describe("17. nenhuma chamada real à Meta é possível nesta fase", () => {
  it("fetchInsights é 100% injetado — sem fake, nada acontece além do contrato", async () => {
    const calls: string[] = [];
    const deps = baseDeps({
      fetchInsights: vi.fn(async () => {
        calls.push("fetchInsights chamado");
        return { rows: [], pages: 0 };
      }),
    });
    await executeBackfillSegment(TASK, deps);
    // a única evidência de "chamada" é o mock injetado pelo teste — não há
    // nenhum adapter real de rede em lib/backfill/executor.ts.
    expect(calls).toEqual(["fetchInsights chamado"]);
  });

  it("guarda estática: o CÓDIGO de executor.ts não contém nenhuma chamada de rede real", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../lib/backfill/executor.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toContain("graph.facebook.com");
    expect(src).not.toMatch(/XMLHttpRequest|axios/);
  });
});
