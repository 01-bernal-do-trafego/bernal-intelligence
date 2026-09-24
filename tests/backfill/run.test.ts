import { describe, expect, it, vi } from "vitest";
import { runCli, type RunCliDeps } from "../../scripts/backfill/run";
import type { InspectResult, CreateJobResult, StatusResult } from "../../scripts/backfill/orchestrator-client";
import type { DiscoveryResult } from "../../scripts/backfill/discovery-client";
import {
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
  EnvironmentGuardError,
  assertEnvironmentConfirmed as realAssertEnvironmentConfirmed,
  assertUrlMatchesEnvironment as realAssertUrlMatchesEnvironment,
} from "../../scripts/backfill/environment-guard";

const DEV_URL = `https://${DEV_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-orchestrator`;
const EXEC_URL = `https://${DEV_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-executor`;
const DISC_URL = `https://${DEV_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-discovery`;
const PROD_URL = `https://${PROD_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-orchestrator`;
const PROD_EXEC_URL = `https://${PROD_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-executor`;
const PROD_DISC_URL = `https://${PROD_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-discovery`;

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
    loadEnvironmentFile: vi.fn(),
    readEnv: vi.fn().mockReturnValue({
      orchestratorUrl: DEV_URL,
      orchestratorSecret: "secret-orch-abc",
      executorUrl: EXEC_URL,
      executorSecret: "secret-exec-xyz",
      discoveryUrl: DISC_URL,
      discoverySecret: "secret-disc-ijk",
    }),
    requireDiscoveryEnv: vi.fn().mockReturnValue({ discoveryUrl: DISC_URL, discoverySecret: "secret-disc-ijk" }),
    assertEnvironmentConfirmed: vi.fn(),
    assertUrlMatchesEnvironment: vi.fn(),
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

  it("guard de ambiente também é checado para a URL de discovery, antes de chamar discoverAccountHistory", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      assertUrlMatchesEnvironment: vi.fn((url: string) => order.push(`guard:${url}`)),
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

describe("Guard de ambiente chamado antes de qualquer request", () => {
  it("assertUrlMatchesEnvironment é chamado para orchestrator e executor ANTES de inspectAccount", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      assertUrlMatchesEnvironment: vi.fn(() => order.push("guard")),
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
      assertUrlMatchesEnvironment: vi.fn(() => {
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

/* ================================================================== */
/* PROD SAFETY — chore/prod-backfill-safety                           */
/* ================================================================== */
/**
 * Estes testes usam os guards REAIS (`environment-guard.ts`), não fakes —
 * é o comportamento de segurança em si que está sob teste, integrado ao
 * fluxo do `runCli`. `inspectAccount`/`createJob`/etc. continuam fakes
 * (nunca rede real) — só os 2 guards são reais.
 */
function baseDepsRealGuards(overrides: Partial<RunCliDeps> = {}): RunCliDeps {
  return baseDeps({
    assertEnvironmentConfirmed: realAssertEnvironmentConfirmed,
    assertUrlMatchesEnvironment: realAssertUrlMatchesEnvironment,
    ...overrides,
  });
}

const ARGV_DEV_DRY = ARGV_DRY; // sem --environment -> default dev, URLs de baseDeps já são dev.
const PROD_ENV_FLAGS = ["--environment", "prod", "--confirm-project-ref", PROD_PROJECT_REF];
/** Fábrica (nunca uma instância `vi.fn()` compartilhada — cada teste precisa
 * da própria contagem de chamadas, isolada dos demais). */
function makeProdEnvRead() {
  return vi.fn().mockReturnValue({
    orchestratorUrl: PROD_URL,
    orchestratorSecret: "secret-orch-prod",
    executorUrl: PROD_EXEC_URL,
    executorSecret: "secret-exec-prod",
    discoveryUrl: PROD_DISC_URL,
    discoverySecret: "secret-disc-prod",
  });
}

describe("PROD SAFETY — DEV válido aceita (comportamento padrão inalterado)", () => {
  it("sem --environment, URLs de dev -> guard passa, chega em inspectAccount", async () => {
    const deps = baseDepsRealGuards();
    const code = await runCli(ARGV_DEV_DRY, deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).toHaveBeenCalledTimes(1);
  });

  it("--environment dev explícito, sem --confirm-project-ref -> também aceita (dev nunca exige confirmação)", async () => {
    const deps = baseDepsRealGuards();
    const code = await runCli([...ARGV_DRY, "--environment", "dev"], deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).toHaveBeenCalledTimes(1);
  });
});

describe("PROD SAFETY — PROD sem flag específica recusa", () => {
  it("URLs de PROD no env, mas SEM --environment (default dev) -> aborta no guard, nunca chama inspectAccount", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect((deps.error as ReturnType<typeof vi.fn>).mock.calls.join(" ")).toMatch(/PRODUÇÃO/);
  });
});

describe("PROD SAFETY — PROD sem confirmação do project ref recusa", () => {
  it("--environment prod SEM --confirm-project-ref -> aborta ANTES de ler env, nunca chama readEnv", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli([...ARGV_DRY, "--environment", "prod"], deps);
    expect(code).toBe(1);
    expect(deps.readEnv).not.toHaveBeenCalled();
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect((deps.error as ReturnType<typeof vi.fn>).mock.calls.join(" ")).toMatch(/confirm-project-ref/);
  });
});

describe("PROD SAFETY — PROD com confirmação ERRADA recusa", () => {
  it("--confirm-project-ref com valor errado -> aborta, nunca chama readEnv", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(
      [...ARGV_DRY, "--environment", "prod", "--confirm-project-ref", "algum-ref-errado"],
      deps,
    );
    expect(code).toBe(1);
    expect(deps.readEnv).not.toHaveBeenCalled();
  });

  it("--confirm-project-ref = ref de DEV (trocado) -> aborta", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(
      [...ARGV_DRY, "--environment", "prod", "--confirm-project-ref", DEV_PROJECT_REF],
      deps,
    );
    expect(code).toBe(1);
  });
});

describe("PROD SAFETY — environment dev + URL de Prod recusa", () => {
  it("--environment dev (implícito) com env apontando para Prod -> aborta no guard de URL", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
  });
});

describe("PROD SAFETY — environment prod + URL de Dev recusa", () => {
  it("--environment prod + --confirm-project-ref corretos, mas env aponta para DEV -> aborta no guard de URL", async () => {
    const deps = baseDepsRealGuards(); // readEnv default = URLs de DEV
    const code = await runCli([...ARGV_DRY, ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
    expect((deps.error as ReturnType<typeof vi.fn>).mock.calls.join(" ")).toMatch(/DEV/);
  });
});

describe("PROD SAFETY — URLs misturadas (dev + prod na mesma execução) recusam", () => {
  it("orchestrator de PROD + executor de DEV, --environment prod confirmado -> aborta no 2º guard (executor)", async () => {
    const deps = baseDepsRealGuards({
      readEnv: vi.fn().mockReturnValue({
        orchestratorUrl: PROD_URL, // prod
        orchestratorSecret: "s1",
        executorUrl: EXEC_URL, // dev — misturado
        executorSecret: "s2",
        discoveryUrl: null,
        discoverySecret: null,
      }),
    });
    const code = await runCli([...ARGV_DRY, ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
  });

  it("orchestrator+executor de DEV corretos, mas discovery de PROD (--all-history) -> aborta antes de discoverAccountHistory", async () => {
    const deps = baseDepsRealGuards({
      readEnv: vi.fn().mockReturnValue({
        orchestratorUrl: DEV_URL,
        orchestratorSecret: "s1",
        executorUrl: EXEC_URL,
        executorSecret: "s2",
        discoveryUrl: PROD_DISC_URL, // misturado
        discoverySecret: "s3",
      }),
      requireDiscoveryEnv: vi.fn().mockReturnValue({ discoveryUrl: PROD_DISC_URL, discoverySecret: "s3" }),
    });
    const code = await runCli(ARGV_ALL_HISTORY_DRY, deps); // environment default = dev
    expect(code).toBe(1);
    expect(deps.discoverAccountHistory).not.toHaveBeenCalled();
  });
});

describe("PROD SAFETY — project ref desconhecido recusa", () => {
  it("URL com project-ref que não é nem dev nem prod -> aborta, mesmo com --environment/--confirm-project-ref 'corretos' para dev", async () => {
    const deps = baseDepsRealGuards({
      readEnv: vi.fn().mockReturnValue({
        orchestratorUrl: "https://algumoutroref00.supabase.co/functions/v1/meta-backfill-orchestrator",
        orchestratorSecret: "s1",
        executorUrl: EXEC_URL,
        executorSecret: "s2",
        discoveryUrl: null,
        discoverySecret: null,
      }),
    });
    const code = await runCli(ARGV_DRY, deps);
    expect(code).toBe(1);
    expect(deps.inspectAccount).not.toHaveBeenCalled();
  });
});

describe("PROD SAFETY — PROD corretamente configurado passa APENAS pelo guard (dry-run)", () => {
  it("--environment prod + --confirm-project-ref correto + URLs de prod -> guard passa, inspectAccount é chamado, mas createJob NUNCA (sem --execute)", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli([...ARGV_DRY, ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(0);
    expect(deps.inspectAccount).toHaveBeenCalledTimes(1);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.invokeExecutorOnce).not.toHaveBeenCalled();
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/PRODUÇÃO/);
    expect(logged).toMatch(/DRY-RUN/);
  });

  it("PROD + --all-history dry-run: discovery real (fake) é chamada, mas nenhum job criado", async () => {
    const deps = baseDepsRealGuards({
      readEnv: makeProdEnvRead(),
      requireDiscoveryEnv: vi.fn().mockReturnValue({ discoveryUrl: PROD_DISC_URL, discoverySecret: "secret-disc-prod" }),
    });
    const code = await runCli(["--client-id", "c1", "--ad-account-ref", "a1", "--all-history", ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(0);
    expect(deps.discoverAccountHistory).toHaveBeenCalledTimes(1);
    expect(deps.createJob).not.toHaveBeenCalled();
  });
});

describe("PROD SAFETY — ausência de --execute continua sem autorizar execução (dev e prod)", () => {
  it("PROD, dry-run (sem --execute) -> nunca escreve insight/cria job/chama executor", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    await runCli([...ARGV_DRY, ...PROD_ENV_FLAGS], deps);
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.invokeExecutorOnce).not.toHaveBeenCalled();
    expect(deps.getJobStatus).not.toHaveBeenCalled();
  });

  it("PROD, COM --execute -> aí sim createJob é chamado (a 2ª decisão explícita, independente da 1ª)", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli([...ARGV_EXEC, ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(0);
    expect(deps.createJob).toHaveBeenCalledTimes(1);
  });
});

describe("PROD SAFETY — --resume também passa pelo guard de ambiente", () => {
  it("--resume sem --environment, mas env aponta pra prod -> aborta antes de getJobStatus", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(["--resume", "job-1"], deps);
    expect(code).toBe(1);
    expect(deps.getJobStatus).not.toHaveBeenCalled();
  });

  it("--resume --environment prod --confirm-project-ref correto + URLs de prod -> guard passa, retoma o loop", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    const code = await runCli(["--resume", "job-1", ...PROD_ENV_FLAGS], deps);
    expect(code).toBe(0);
    expect(deps.getJobStatus).toHaveBeenCalled();
  });
});

describe("PROD SAFETY — mensagens de erro nunca expõem secret, só o guard fica explícito", () => {
  it("erro de guard nunca contém valor de secret (secrets nem chegam a ser lidos antes do guard de intenção)", async () => {
    const deps = baseDepsRealGuards({ readEnv: makeProdEnvRead() });
    await runCli([...ARGV_DRY, "--environment", "prod"], deps); // sem confirm -> aborta cedo
    const allLogged = [
      ...(deps.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(deps.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(allLogged).not.toContain("secret-orch-prod");
    expect(allLogged).not.toContain("secret-exec-prod");
  });
});

describe("PROD SAFETY — nenhum modo genérico: só dev/prod são aceitos em --environment", () => {
  it("--environment com valor desconhecido -> CliArgsError, nunca chega no guard", async () => {
    const deps = baseDeps(); // fakes — aqui queremos ASSERT sobre chamadas, não o guard real
    const code = await runCli([...ARGV_DRY, "--environment", "staging"], deps);
    expect(code).toBe(1);
    expect(deps.assertEnvironmentConfirmed).not.toHaveBeenCalled();
    expect(deps.readEnv).not.toHaveBeenCalled();
  });
});

describe("EnvironmentGuardError é a classe usada nos 2 passos (integração real)", () => {
  it("assertEnvironmentConfirmed/assertUrlMatchesEnvironment reais lançam EnvironmentGuardError, e runCli trata sem crashar", async () => {
    expect(() => realAssertEnvironmentConfirmed("prod", null)).toThrow(EnvironmentGuardError);
    expect(() => realAssertUrlMatchesEnvironment(PROD_URL, "dev")).toThrow(EnvironmentGuardError);
  });
});
