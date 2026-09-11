import { describe, expect, it } from "vitest";
import {
  canJobProvideSegments,
  isClaimableSegmentStatus,
  isTerminalJobStatus,
  isTerminalSegmentStatus,
  isValidJobTransition,
  isValidSegmentTransition,
} from "@/lib/backfill/transitions";
import type { BackfillJobStatus, BackfillSegmentStatus } from "@/lib/backfill/types";

const JOB_STATUSES: readonly BackfillJobStatus[] = [
  "pending",
  "running",
  "paused",
  "completed",
  "exhausted",
  "failed",
  "cancelled",
];
const SEGMENT_STATUSES: readonly BackfillSegmentStatus[] = [
  "pending",
  "running",
  "done",
  "failed",
  "skipped_no_data",
];

describe("1. statuses válidos do JOB", () => {
  it("os 7 estados conceituais existem e são distintos", () => {
    expect(new Set(JOB_STATUSES).size).toBe(7);
  });
  it("terminais: completed, exhausted, failed, cancelled", () => {
    for (const s of ["completed", "exhausted", "failed", "cancelled"] as const) {
      expect(isTerminalJobStatus(s), s).toBe(true);
    }
  });
  it("não-terminais: pending, running, paused", () => {
    for (const s of ["pending", "running", "paused"] as const) {
      expect(isTerminalJobStatus(s), s).toBe(false);
    }
  });
});

describe("2. statuses válidos do SEGMENT", () => {
  it("os 5 estados conceituais existem e são distintos", () => {
    expect(new Set(SEGMENT_STATUSES).size).toBe(5);
  });
  it("terminais: done, skipped_no_data", () => {
    expect(isTerminalSegmentStatus("done")).toBe(true);
    expect(isTerminalSegmentStatus("skipped_no_data")).toBe(true);
  });
  it("não-terminais: pending, running, failed (failed permite retry)", () => {
    expect(isTerminalSegmentStatus("pending")).toBe(false);
    expect(isTerminalSegmentStatus("running")).toBe(false);
    expect(isTerminalSegmentStatus("failed")).toBe(false);
  });
});

describe("3. transições válidas/inválidas do JOB", () => {
  it("exemplo do ticket: pending->running, running->paused, paused->running, running->completed, running->exhausted", () => {
    expect(isValidJobTransition("pending", "running")).toBe(true);
    expect(isValidJobTransition("running", "paused")).toBe(true);
    expect(isValidJobTransition("paused", "running")).toBe(true);
    expect(isValidJobTransition("running", "completed")).toBe(true);
    expect(isValidJobTransition("running", "exhausted")).toBe(true);
  });

  it("mesmo status é sempre uma transição válida (update que não muda status)", () => {
    for (const s of JOB_STATUSES) {
      expect(isValidJobTransition(s, s), s).toBe(true);
    }
  });

  it("transições ABSURDAS são recusadas", () => {
    expect(isValidJobTransition("completed", "running")).toBe(false);
    expect(isValidJobTransition("cancelled", "pending")).toBe(false);
    expect(isValidJobTransition("pending", "completed")).toBe(false); // pula running
    expect(isValidJobTransition("paused", "completed")).toBe(false); // precisa voltar a running antes
    expect(isValidJobTransition("exhausted", "failed")).toBe(false);
    expect(isValidJobTransition("failed", "running")).toBe(false); // retry de job failed = novo job
  });

  it("nenhum status terminal tem transição de saída", () => {
    for (const from of ["completed", "exhausted", "failed", "cancelled"] as const) {
      for (const to of JOB_STATUSES) {
        if (to === from) continue;
        expect(isValidJobTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe("6/10. job paused/terminal não fornece segmento", () => {
  it("só 'running' fornece segmento", () => {
    expect(canJobProvideSegments("running")).toBe(true);
    for (const s of ["pending", "paused", "completed", "exhausted", "failed", "cancelled"] as const) {
      expect(canJobProvideSegments(s), s).toBe(false);
    }
  });
});

describe("3. claim só trabalha com pending — failed nunca é reivindicado direto", () => {
  it("isClaimableSegmentStatus: só 'pending'", () => {
    expect(isClaimableSegmentStatus("pending")).toBe(true);
    for (const s of ["running", "done", "failed", "skipped_no_data"] as const) {
      expect(isClaimableSegmentStatus(s), s).toBe(false);
    }
  });
  it("failed precisa passar por pending antes de poder rodar de novo (2 passos, nunca 1)", () => {
    expect(isValidSegmentTransition("failed", "running")).toBe(false);
    expect(isValidSegmentTransition("failed", "pending")).toBe(true);
    expect(isValidSegmentTransition("pending", "running")).toBe(true);
  });
});

describe("transições válidas/inválidas do SEGMENT", () => {
  it("pending -> running", () => {
    expect(isValidSegmentTransition("pending", "running")).toBe(true);
  });
  it("running -> done, failed, skipped_no_data, pending (lease)", () => {
    expect(isValidSegmentTransition("running", "done")).toBe(true);
    expect(isValidSegmentTransition("running", "failed")).toBe(true);
    expect(isValidSegmentTransition("running", "skipped_no_data")).toBe(true);
    expect(isValidSegmentTransition("running", "pending")).toBe(true);
  });
  it("failed -> pending (retry)", () => {
    expect(isValidSegmentTransition("failed", "pending")).toBe(true);
  });
  it("mesmo status é sempre válido", () => {
    for (const s of SEGMENT_STATUSES) {
      expect(isValidSegmentTransition(s, s), s).toBe(true);
    }
  });
  it("transições absurdas são recusadas", () => {
    expect(isValidSegmentTransition("done", "running")).toBe(false);
    expect(isValidSegmentTransition("skipped_no_data", "pending")).toBe(false);
    expect(isValidSegmentTransition("pending", "done")).toBe(false); // pula running
    expect(isValidSegmentTransition("failed", "done")).toBe(false); // precisa passar por running
  });
  it("nenhum status terminal tem transição de saída", () => {
    for (const from of ["done", "skipped_no_data"] as const) {
      for (const to of SEGMENT_STATUSES) {
        if (to === from) continue;
        expect(isValidSegmentTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});
