import { describe, expect, it } from "vitest";
import { shouldAutoCompleteJob } from "@/lib/backfill/job-completion";

describe("DATA V2.2.4 — shouldAutoCompleteJob (espelha o WHERE do UPDATE de job em complete_backfill_segment)", () => {
  it("A) 1 único segmento done, job running -> completed", () => {
    expect(shouldAutoCompleteJob("running", ["done"])).toBe(true);
  });

  it("B) 1 único segmento skipped_no_data, job running -> completed", () => {
    expect(shouldAutoCompleteJob("running", ["skipped_no_data"])).toBe(true);
  });

  it("C) done + pending -> continua running", () => {
    expect(shouldAutoCompleteJob("running", ["done", "pending"])).toBe(false);
  });

  it("D) done + running -> continua running", () => {
    expect(shouldAutoCompleteJob("running", ["done", "running"])).toBe(false);
  });

  it("E) done + failed -> continua running (segment failed é retryable, não terminal p/ esta regra)", () => {
    expect(shouldAutoCompleteJob("running", ["done", "failed"])).toBe(false);
  });

  it("F) todos done/skipped_no_data (mix) -> completed", () => {
    expect(shouldAutoCompleteJob("running", ["done", "skipped_no_data", "done", "skipped_no_data"])).toBe(true);
  });

  it("H) job paused -> não auto-finaliza mesmo com todos os segmentos terminais", () => {
    expect(shouldAutoCompleteJob("paused", ["done", "skipped_no_data"])).toBe(false);
  });

  it("I) job cancelled/failed/exhausted/completed -> nunca altera, mesmo com todos terminais", () => {
    for (const status of ["cancelled", "failed", "exhausted", "completed"] as const) {
      expect(shouldAutoCompleteJob(status, ["done", "skipped_no_data"])).toBe(false);
    }
  });

  it("I) job pending -> nunca auto-finaliza (só running participa)", () => {
    expect(shouldAutoCompleteJob("pending", ["done"])).toBe(false);
  });

  it("J) job sem segmentos -> não auto-finaliza (helper isolado nunca completa job vazio)", () => {
    expect(shouldAutoCompleteJob("running", [])).toBe(false);
  });

  it("nunca decide 'exhausted' — só devolve boolean de completar ou não", () => {
    // a própria assinatura do tipo de retorno já garante isso (boolean),
    // mas o teste documenta a intenção explicitamente.
    const result = shouldAutoCompleteJob("running", ["done"]);
    expect(typeof result).toBe("boolean");
  });
});
