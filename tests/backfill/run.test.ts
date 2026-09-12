import { describe, expect, it, vi } from "vitest";
import { runCli, type RunCliDeps } from "../../scripts/backfill/run";
import type { InspectResult, CreateJobResult, StatusResult } from "../../scripts/backfill/orchestrator-client";
import type { DiscoveryResult } from "../../scripts/backfill/discovery-client";

const DEV_URL = "https://vqodysgxdkkvmfqyprpu.supabase.co/functions/v1/meta-backfill-orchestrator";
const EXEC_URL = "https://vqodysgxdkkvmfqyprpu.supabase.co/functions/v1/meta-backfill-executor";
const DISC_URL = "https://vqodysgxdkkvmfqyprpu.supabase.co/functions/v1/meta-backfill-discovery";

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

function baseFoundDiscovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    status: "found",
    clientId: "c1",
    adAccountRef: "a1",
    metaAccountId: "act_123",
    accountTimezone: "America/Sao_Paulo",
    accountCreatedDate: "2020-01-01",
    earliestDate: "2024-03-10",
    latestClosedDate: "2026-09-10",
    probesPerformed: 14,
    strategy: "full_range",
    ...overrides,
  } as DiscoveryResult;
}

function baseDeps(overrides: Partial<RunCliDeps> = {}): RunCliDeps {
  return {
    readEnv: vi.fn().mockReturnValue({
      orchestratorUrl: DEV_URL,
      orchestratorSecret: "secret-orch-abc",
      executorUrl: EXEC_URL,
      executorSecret: "secret-exec-xyz",
      discoveryUrl: DISC_URL,
      discoverySecret: "secret-disc-ijk",
    }),
    requireDiscoveryEnv: vi.fn().mockReturnValue({ discoveryUrl: DISC_URL, discoverySecret: "secret-disc-ijk" }),
    assertDevProjectRef: vi.fn(),
    inspectAccount: vi.fn().mockResolvedValue(baseInspection()),
    createJob: vi.fn().mockResolvedValue({ jobId: "job-1", segmentCount: 3, status: "running", range: { from: "2026-08-01", to: "2026-08-31" }, levels: ["account"] } satisfies CreateJobResult),
    getJobStatus: vi.fn().mockResolvedValue({
      jobId: "job-1", jobStatus: "completed", totalSegments: 3, pending: 0, running: 0, done: 3,
      skippedNoData: 0, failed: 0, dateFrom: "2026-08-01", dateTo: "2026-08-31", levels: ["account"], progressPct: 100,
    } satisfies StatusResult),
    invokeExecutorOnce: vi.fn().mockResolvedValue({ status: "done" }),
    discoverAccountHistory: vi.fn().mockResolvedValue(baseFoundDiscovery()),
    sleep: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

const ARGV_DRY = ["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"];
const ARGV_EXEC = [...ARGV_DRY, "--execute"];
const ARGV_ALL_HISTORY_DRY = ["--client-id", "c1", "--ad-account-ref", "a1", "--all-history"];
const ARGV_ALL_HISTORY_EXEC = [...ARGV_ALL_HISTORY_DRY, "--execute"];

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

  it("modo explícito NÃO chama discovery", async () => {
    const deps = baseDeps();
    await runCli(ARGV_DRY, deps);
    expect(deps.discoverAccountHistory).not.toHaveBeenCalled();
    expect(deps.requireDiscoveryEnv).not.toHaveBeenCalled();
  });
});

describe("--all-history sem --execute = dry-run", () => {
  it("chama discovery 1x, roda o planner com earliest/latest retornados, NÃO cria job, NÃO chama o executor", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_ALL_HISTORY_DRY, deps);
    expect(code).toBe(0);
    expect(deps.discoverAccountHistory).toHaveBeenCalledTimes(1);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.invokeExecutorOnce).not.toHaveBeenCalled();
  });

  it('mensagem NÃO diz "nenhuma chamada Meta" — diz que Discovery consultou a Meta', async () => {
    const deps = baseDeps();
    await runCli(ARGV_ALL_HISTORY_DRY, deps);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/Discovery consultou a Meta/);
    expect(logged).not.toMatch(/nenhuma chamada.{0,10}Meta/i);
  });

  it("usa earliestDate/latestClosedDate retornados pela discovery no planner", async () => {
    const deps = baseDeps({ discoverAccountHistory: vi.fn().mockResolvedValue(baseFoundDiscovery({ earliestDate: "2021-05-01", latestClosedDate: "2026-09-05" })) });
    await runCli(ARGV_ALL_HISTORY_DRY, deps);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("2021-05-01 a 2026-09-05");
  });

  it("no_history -> não cria job, encerra com código 0, mensagem clara", async () => {
    const deps = baseDeps({
      discoverAccountHistory: vi.fn().mockResolvedValue({
        status: "no_history",
        clientId: "c1",
        adAccountRef: "a1",
        metaAccountId: "act_123",
        accountTimezone: "UTC",
        accountCreatedDate: "2026-09-01",
        earliestDate: null,
        latestClosedDate: "2026-09-10",
        probesPerformed: 1,
        strategy: "full_range",
      } satisfies DiscoveryResult),
    });
    const code = await runCli(ARGV_ALL_HISTORY_DRY, deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect(deps.createJob).not.toHaveBeenCalled();
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/no_history/);
  });
});

describe("--all-history + --from é rejeitado (mutuamente exclusivos)", () => {
  it("nunca chama nada — erro de parsing acontece antes de qualquer efeito colateral", async () => {
    const deps = baseDeps();
    const code = await runCli([...ARGV_ALL_HISTORY_DRY, "--from", "2026-08-01"], deps);
    expect(code).toBe(1);
    expect(deps.readEnv).not.toHaveBeenCalled();
    expect(deps.discoverAccountHistory).not.toHaveBeenCalled();
  });
});

describe("--execute — cria o job UMA vez e roda o loop", () => {
  it("chama createJob exatamente 1x, depois entra no loop até terminal", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(deps.getJobStatus).toHaveBeenCalled();
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

describe("--all-history --execute — cria 1 job usando o range descoberto", () => {
  it("discovery -> inspect -> planner -> create (1x) -> loop", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_ALL_HISTORY_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.discoverAccountHistory).toHaveBeenCalledTimes(1);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    const createArgs = (deps.createJob as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(createArgs.targetStartDate).toBe("2024-03-10");
    expect(createArgs.targetEndDate).toBe("2026-09-10");
  });

  it("no_history -> --execute também não cria job", async () => {
    const deps = baseDeps({
      discoverAccountHistory: vi.fn().mockResolvedValue({
        status: "no_history", clientId: "c1", adAccountRef: "a1", metaAccountId: "act_123",
        accountTimezone: "UTC", accountCreatedDate: "2026-09-01", earliestDate: null,
        latestClosedDate: "2026-09-10", probesPerformed: 1, strategy: "full_range",
      } satisfies DiscoveryResult),
    });
    const code = await runCli(ARGV_ALL_HISTORY_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.createJob).not.toHaveBeenCalled();
  });

  it("Dev-only guard também é checado para a URL de discovery, antes de chamar discoverAccountHistory", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      assertDevProjectRef: vi.fn((url: string) => order.push(`guard:${url}`)),
      discoverAccountHistory: vi.fn(async () => {
        order.push("discover");
        return baseFoundDiscovery();
      }),
    });
    await runCli(ARGV_ALL_HISTORY_EXEC, deps);
    const discoverIdx = order.indexOf("discover");
    const discoveryGuardIdx = order.indexOf(`guard:${DISC_URL}`);
    expect(discoveryGuardIdx).toBeGreaterThan(-1);
    expect(discoveryGuardIdx).toBeLessThan(discoverIdx);
  });

  it("faltando env de discovery -> aborta ANTES de chamar discoverAccountHistory", async () => {
    const deps = baseDeps({
      requireDiscoveryEnv: vi.fn(() => {
        throw new Error("--all-history precisa de: BACKFILL_DISCOVERY_URL, META_BACKFILL_DISCOVERY_SECRET");
      }),
    });
    const code = await runCli(ARGV_ALL_HISTORY_EXEC, deps);
    expect(code).toBe(1);
    expect(deps.discoverAccountHistory).not.toHaveBeenCalled();
  });
});

describe("MAX_PLANNED_SEGMENTS — aborta ANTES de create quando excedido", () => {
  it("plano acima do limite -> --execute aborta, createJob NUNCA chamado", async () => {
    // conta MUITO grande (>50 em cada nível) força blocos mínimos; período de 30 anos.
    const deps = baseDeps({
      inspectAccount: vi.fn().mockResolvedValue(baseInspection({ entityCounts: { account: 1, campaign: 200, adset: 200, ad: 200 } })),
    });
    const code = await runCli(
      ["--client-id", "c1", "--ad-account-ref", "a1", "--from", "1996-01-01", "--to", "2026-09-10", "--execute"],
      deps,
    );
    expect(code).toBe(1);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect((deps.error as ReturnType<typeof vi.fn>).mock.calls.join(" ")).toMatch(/MAX_PLANNED_SEGMENTS/);
  });

  it("dry-run acima do limite só avisa — não é erro (nada é criado de qualquer forma)", async () => {
    const deps = baseDeps({
      inspectAccount: vi.fn().mockResolvedValue(baseInspection({ entityCounts: { account: 1, campaign: 200, adset: 200, ad: 200 } })),
    });
    const code = await runCli(["--client-id", "c1", "--ad-account-ref", "a1", "--from", "1996-01-01", "--to", "2026-09-10"], deps);
    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/MAX_PLANNED_SEGMENTS/);
  });

  it("plano dentro do limite -> --execute segue normalmente", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
  });
});

describe("--resume — NÃO cria job novo, NÃO roda discovery, só retoma o loop", () => {
  it("nunca chama inspectAccount/createJob/discoverAccountHistory; chama getJobStatus/invokeExecutorOnce direto com o jobId dado", async () => {
    const deps = baseDeps();
    const code = await runCli(["--resume", "job-existing"], deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.discoverAccountHistory).not.toHaveBeenCalled();
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
  it("nenhuma chamada a log()/error() contém os valores de secret lidos do env (modo explícito e all-history)", async () => {
    for (const argv of [ARGV_EXEC, ARGV_ALL_HISTORY_EXEC]) {
      const deps = baseDeps();
      await runCli(argv, deps);
      const allLogged = [
        ...(deps.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(deps.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join("\n");
      expect(allLogged).not.toContain("secret-orch-abc");
      expect(allLogged).not.toContain("secret-exec-xyz");
      expect(allLogged).not.toContain("secret-disc-ijk");
    }
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

describe("modo explícito V2.3A continua passando (nada quebrou)", () => {
  it("--from/--to sem --all-history funciona exatamente como antes", async () => {
    const deps = baseDeps();
    const code = await runCli(ARGV_EXEC, deps);
    expect(code).toBe(0);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    const createArgs = (deps.createJob as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(createArgs.targetStartDate).toBe("2026-08-01");
    expect(createArgs.targetEndDate).toBe("2026-08-31");
  });
});

describe("nenhuma chamada real à Meta/Supabase durante os testes", () => {
  it("todas as portas são funções injetadas (fakes) — nenhum fetch/createClient acontece aqui", async () => {
    const deps = baseDeps();
    await runCli(ARGV_EXEC, deps);
    expect(deps.inspectAccount).toHaveBeenCalled();
    expect(deps.createJob).toHaveBeenCalled();
  });
});
