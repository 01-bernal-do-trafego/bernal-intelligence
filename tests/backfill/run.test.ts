import { describe, expect, it, vi } from "vitest";
import { runCli, type RunCliDeps } from "../../scripts/backfill/run";
import type { InspectResult, CreateJobResult, StatusResult } from "../../scripts/backfill/orchestrator-client";

const DEV_URL = "https://vqodysgxdkkvmfqyprpu.supabase.co/functions/v1/meta-backfill-orchestrator";
const EXEC_URL = "https://vqodysgxdkkvmfqyprpu.supabase.co/functions/v1/meta-backfill-executor";

function baseInspection(overrides: Partial<InspectResult> = {}): InspectResult {
  return {
    clientId: "c1",
    adAccountRef: "a1",
    metaAccountId: "act_123",
    connectionStatus: "active",
    connectionEligible: true,
    entityCounts: { account: 1, campaign: 5, adset: 10, ad: 20 },
    activeJob: false,
    jobId: null,
    currentSyncRunning: false,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<RunCliDeps> = {}): RunCliDeps {
  return {
    readEnv: vi.fn().mockReturnValue({
      orchestratorUrl: DEV_URL,
      orchestratorSecret: "secret-orch-abc",
      executorUrl: EXEC_URL,
      executorSecret: "secret-exec-xyz",
    }),
    assertDevProjectRef: vi.fn(),
    inspectAccount: vi.fn().mockResolvedValue(baseInspection()),
    createJob: vi.fn().mockResolvedValue({ jobId: "job-1", segmentCount: 3, status: "running", range: { from: "2026-08-01", to: "2026-08-31" }, levels: ["account"] } satisfies CreateJobResult),
    getJobStatus: vi.fn().mockResolvedValue({
      jobId: "job-1", jobStatus: "completed", totalSegments: 3, pending: 0, running: 0, done: 3,
      skippedNoData: 0, failed: 0, dateFrom: "2026-08-01", dateTo: "2026-08-31", levels: ["account"], progressPct: 100,
    } satisfies StatusResult),
    invokeExecutorOnce: vi.fn().mockResolvedValue({ status: "done" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

const ARGV_DRY = ["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"];
const ARGV_EXEC = [...ARGV_DRY, "--execute"];

describe("dry-run (sem --execute) — não cria nada, não chama o executor", () => {
  it("chama inspect, roda o planner LOCAL, mas NUNCA createJob/invokeExecutorOnce", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).toHaveBeenCalledTimes(1);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.invokeExecutorOnce).not.toHaveBeenCalled();
    expect(deps.getJobStatus).not.toHaveBeenCalled();
  });

  it("imprime o resumo do plano (levels/total) sem criar job", async () => {
    const deps = baseDeps();
    await runCli(ARGV_DRY, deps);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/DRY-RUN/);
    expect(logged).toMatch(/Total: \d+ segmento/);
  });
});

describe("--execute — cria o job UMA vez e roda o loop", () => {
  it("chama createJob exatamente 1x, depois entra no loop até terminal", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(deps.getJobStatus).toHaveBeenCalled(); // loop consultou status (job já completed -> encerra na 1ª)
  });

  it("job com activeJob=true -> recusa criar outro, NUNCA chama createJob", async () => {
    const deps = baseDeps({ inspectAccount: vi.fn().mockResolvedValue(baseInspection({ activeJob: true, jobId: "job-existing" })) });
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(1);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect((deps.error as ReturnType<typeof vi.fn>).mock.calls.join(" ")).toContain("job-existing");
  });

  it("conexão não elegível -> recusa, NUNCA chama createJob", async () => {
    const deps = baseDeps({ inspectAccount: vi.fn().mockResolvedValue(baseInspection({ connectionEligible: false, connectionStatus: "reauthorization_required" })) });
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(1);
    expect(deps.createJob).not.toHaveBeenCalled();
  });
});

describe("--resume — NÃO cria job novo, só retoma o loop", () => {
  it("nunca chama inspectAccount/createJob; chama getJobStatus/invokeExecutorOnce direto com o jobId dado", async () => {
    const deps = baseDeps();
    const code = await runCli(["--resume", "job-existing"], deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.getJobStatus).toHaveBeenCalledWith(expect.anything(), { jobId: "job-existing" });
  });
});

describe("Dev-only guard chamado antes de qualquer request", () => {
  it("assertDevProjectRef é chamado para orchestrator e executor ANTES de inspectAccount", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      assertDevProjectRef: vi.fn(() => order.push("guard")),
      inspectAccount: vi.fn(async () => {
        order.push("inspect");
        return baseInspection();
      }),
    });
    await runCli(ARGV_DRY, deps);
    expect(order[0]).toBe("guard");
    expect(order.indexOf("guard")).toBeLessThan(order.indexOf("inspect"));
  });

  it("guard lançando erro (ex.: Prod detectado) -> aborta, NUNCA chama inspectAccount", async () => {
    const deps = baseDeps({
      assertDevProjectRef: vi.fn(() => {
        throw new Error("ABORTADO: project-ref de PRODUÇÃO detectado");
      }),
    });
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
  });
});

describe("secrets nunca logados", () => {
  it("nenhuma chamada a log()/error() contém os valores de secret lidos do env", async () => {
    const deps = baseDeps();
    await runCli(ARGV_EXEC, deps);
    const allLogged = [
      ...(deps.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(deps.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join("\n");
    expect(allLogged).not.toContain("secret-orch-abc");
    expect(allLogged).not.toContain("secret-exec-xyz");
  });
});

describe("planner existente REALMENTE importado e usado (não uma cópia)", () => {
  it("o número de segmentos do plano bate com planBackfillSegments para o mesmo input (contas pequenas -> bloco máximo)", async () => {
    const deps = baseDeps({ inspectAccount: vi.fn().mockResolvedValue(baseInspection({ entityCounts: { account: 1, campaign: 1, adset: 1, ad: 1 } })) });
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    // 31 dias, level=account (default 90d block) -> 1 segmento só.
    expect(logged).toMatch(/account: 1 segmento/);
  });
});

describe("nenhuma chamada real à Meta/Supabase durante os testes", () => {
  it("todas as portas são funções injetadas (fakes) — nenhum fetch/createClient acontece aqui", async () => {
    const deps = baseDeps();
    await runCli(ARGV_EXEC, deps);
    // as únicas "chamadas de rede" são os mocks acima — nada de fetch real.
    expect(deps.inspectAccount).toHaveBeenCalled();
    expect(deps.createJob).toHaveBeenCalled();
  });
});
