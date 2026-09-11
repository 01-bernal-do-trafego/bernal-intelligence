import { describe, expect, it, vi } from "vitest";
import { runBackfillLoop, type RunLoopDeps, type StatusSnapshot } from "../../scripts/backfill/loop";

function baseDeps(overrides: Partial<RunLoopDeps> = {}): RunLoopDeps {
  return {
    getStatus: vi.fn().mockResolvedValue({ jobStatus: "running", pending: 1, running: 0, failed: 0 }),
    invokeExecutor: vi.fn().mockResolvedValue({ status: "done" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...overrides,
  };
}

describe("job terminal encerra imediatamente (completed/exhausted/cancelled/failed)", () => {
  for (const status of ["completed", "exhausted", "cancelled", "failed"]) {
    it(`jobStatus=${status} -> para com {kind:"terminal"}, NUNCA chama o executor`, async () => {
      const deps = baseDeps({ getStatus: vi.fn().mockResolvedValue({ jobStatus: status, pending: 0, running: 0, failed: 0 }) });
      const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 5 });
      expect(outcome).toEqual({ kind: "terminal", finalStatus: status });
      expect(deps.invokeExecutor).not.toHaveBeenCalled();
    });
  }
});

describe("job paused -> não auto-finaliza, runner para e reporta (não espera indefinidamente)", () => {
  it('jobStatus="paused" -> {kind:"paused"}, sem chamar o executor', async () => {
    const deps = baseDeps({ getStatus: vi.fn().mockResolvedValue({ jobStatus: "paused", pending: 1, running: 0, failed: 0 }) });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 5 });
    expect(outcome).toEqual({ kind: "paused" });
    expect(deps.invokeExecutor).not.toHaveBeenCalled();
  });
});

describe("segment failed -> para corretamente, não continua agressivamente", () => {
  it("failed > 0 -> {kind:'failed_segment_stopped'}, NUNCA chama o executor", async () => {
    const deps = baseDeps({ getStatus: vi.fn().mockResolvedValue({ jobStatus: "running", pending: 0, running: 0, failed: 2 }) });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 5 });
    expect(outcome).toEqual({ kind: "failed_segment_stopped", failedCount: 2 });
    expect(deps.invokeExecutor).not.toHaveBeenCalled();
  });
});

describe("executor chamado exatamente 1x por iteração", () => {
  it("com trabalho disponível, chama invokeExecutor 1 vez; a 3ª consulta de status (já na 2ª iteração) vê completed e termina", async () => {
    let statusCalls = 0;
    const getStatus = vi.fn(async (): Promise<StatusSnapshot> => {
      statusCalls += 1;
      if (statusCalls <= 2) return { jobStatus: "running", pending: 1, running: 0, failed: 0 };
      return { jobStatus: "completed", pending: 0, running: 0, failed: 0 };
    });
    const invokeExecutor = vi.fn().mockResolvedValue({ status: "done" });
    const deps = baseDeps({ getStatus, invokeExecutor });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 5 });
    expect(invokeExecutor).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "terminal", finalStatus: "completed" });
  });
});

describe("idle — job ainda running espera (não é erro), reseta com progresso real", () => {
  it("idle -> continua o loop (não para), incrementando o contador; um resultado real reseta o contador", async () => {
    let call = 0;
    const invokeExecutor = vi.fn(async () => {
      call += 1;
      return call <= 2 ? { status: "idle" } : { status: "done" };
    });
    let statusCall = 0;
    const getStatus = vi.fn(async () => {
      statusCall += 1;
      // termina na 4ª pergunta de status (depois de idle, idle, done)
      return statusCall >= 7 ? { jobStatus: "completed", pending: 0, running: 0, failed: 0 } : { jobStatus: "running", pending: 1, running: 0, failed: 0 };
    });
    const deps = baseDeps({ getStatus, invokeExecutor });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 10 });
    expect(outcome).toEqual({ kind: "terminal", finalStatus: "completed" });
    expect(invokeExecutor).toHaveBeenCalledTimes(3);
  });
});

describe("idle terminal encerra (o check de terminal, no topo da PRÓXIMA iteração, vem antes de qualquer nova chamada ao executor)", () => {
  it("idle seguido de job completed na próxima checagem -> termina como 'terminal', não como 'idle_guard_triggered'", async () => {
    let n = 0;
    const getStatus = vi.fn(async () => {
      n += 1;
      // 1ª chamada: running com trabalho. 2ª (pós-executor): ainda running (log).
      // 3ª chamada (próxima iteração, topo do loop): completed.
      if (n <= 2) return { jobStatus: "running", pending: 1, running: 0, failed: 0 };
      return { jobStatus: "completed", pending: 0, running: 0, failed: 0 };
    });
    const invokeExecutor = vi.fn().mockResolvedValue({ status: "idle" });
    const deps = baseDeps({ getStatus, invokeExecutor });
    // maxConsecutiveIdle folgado o bastante para não disparar depois do ÚNICO idle
    // desta sequência — o que se quer provar é que o job virar completed evita
    // uma 2ª chamada ao executor, não uma corrida contra a guarda.
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 5 });
    expect(outcome).toEqual({ kind: "terminal", finalStatus: "completed" });
    expect(invokeExecutor).toHaveBeenCalledTimes(1);
  });
});

describe("consecutive idle guard — nunca loop infinito", () => {
  it("idle sempre, job sempre running -> para com idle_guard_triggered após maxConsecutiveIdle", async () => {
    const deps = baseDeps({
      getStatus: vi.fn().mockResolvedValue({ jobStatus: "running", pending: 1, running: 0, failed: 0 }),
      invokeExecutor: vi.fn().mockResolvedValue({ status: "idle" }),
    });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 3 });
    expect(outcome).toEqual({ kind: "idle_guard_triggered", consecutiveIdle: 3 });
    expect(deps.invokeExecutor).toHaveBeenCalledTimes(3);
  });
  it("sem trabalho disponível (pending=0, running=0) mas job não terminal -> também conta como idle (sem chamar o executor)", async () => {
    const deps = baseDeps({
      getStatus: vi.fn().mockResolvedValue({ jobStatus: "running", pending: 0, running: 0, failed: 0 }),
    });
    const outcome = await runBackfillLoop(deps, { delayMs: 1, maxConsecutiveIdle: 2 });
    expect(outcome).toEqual({ kind: "idle_guard_triggered", consecutiveIdle: 2 });
    expect(deps.invokeExecutor).not.toHaveBeenCalled();
  });
});

describe("delay configurável entre invocações", () => {
  it("sleep é chamado com o delayMs configurado a cada iteração completa", async () => {
    let n = 0;
    const getStatus = vi.fn(async () => {
      n += 1;
      return n >= 3 ? { jobStatus: "completed", pending: 0, running: 0, failed: 0 } : { jobStatus: "running", pending: 1, running: 0, failed: 0 };
    });
    const deps = baseDeps({ getStatus });
    await runBackfillLoop(deps, { delayMs: 4242, maxConsecutiveIdle: 10 });
    expect(deps.sleep).toHaveBeenCalledWith(4242);
  });
});
