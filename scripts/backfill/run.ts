#!/usr/bin/env -S npx tsx
/**
 * DATA V2.3A — Historical Backfill Rollout. Runner administrativo (CLI).
 * ---------------------------------------------------------------------------
 * Uma única operação manual para rodar um job de backfill inteiro, sem tocar
 * no SQL Editor.
 *
 *   npm run backfill -- --client-id <uuid> --ad-account-ref <uuid> \
 *     --from 2026-08-01 --to 2026-09-10 --levels account,campaign,adset,ad
 *
 * SEM `--execute`: DRY-RUN (padrão de segurança) — chama `inspect`, roda o
 * planner LOCAL (`lib/backfill/planner.ts#planBackfillSegments`, a ÚNICA
 * fonte de verdade de segmentação — nenhuma cópia do algoritmo aqui),
 * imprime o plano. NÃO cria job, NÃO chama o executor, NÃO chama a Meta.
 *
 * COM `--execute`: inspect -> planner -> `create` (via orchestrator, RPC
 * atômica) -> loop (`./loop.ts#runBackfillLoop`) chamando o executor 1
 * segmento por vez até um desfecho terminal ou uma guarda de segurança.
 *
 *   npm run backfill -- --resume <jobId>
 *
 * NÃO cria outro job — só retoma o loop de execução de um job já existente
 * (útil depois de Ctrl-C: o job continua persistido no banco, nada é
 * cancelado ao interromper o processo — não há handler de SIGINT que toque
 * o job).
 *
 * SECRETS: só de env (`./env.ts`) — `BACKFILL_ORCHESTRATOR_URL`,
 * `META_BACKFILL_ORCHESTRATOR_SECRET`, `BACKFILL_EXECUTOR_URL`,
 * `META_BACKFILL_EXECUTOR_SECRET`. NUNCA aceitos via argumento de CLI,
 * NUNCA impressos.
 *
 * DEV ONLY: `./dev-guard.ts#assertDevProjectRef` recusa qualquer
 * project-ref que não seja o Supabase Dev conhecido — em especial o de
 * Prod, por nome.
 *
 * Sequencial por desenho: nunca mais de 1 invocação do executor "em voo",
 * nunca processa mais de 1 conta por execução do runner. Sem paralelismo
 * entre contas nesta etapa (rollout sequencial).
 *
 * TESTABILIDADE: `runCli(argv, deps)` recebe TODAS as operações com efeito
 * colateral injetadas — é isto que os testes exercitam (com fakes, nunca
 * rede real). O bloco no fim do arquivo só chama `runCli` com as
 * implementações REAIS quando este arquivo é executado diretamente (nunca
 * quando importado por um teste).
 */
import { planBackfillSegments } from "@/lib/backfill/planner";
import type { EntityCountHints } from "@/lib/backfill/block-size";
import { parseRunArgs, CliArgsError, type ParsedRunArgs } from "./cli-args";
import { readRunnerEnv, RunnerEnvError, type RunnerEnv } from "./env";
import { assertDevProjectRef, DevOnlyGuardError } from "./dev-guard";
import {
  inspectAccount as realInspectAccount,
  createJob as realCreateJob,
  getJobStatus as realGetJobStatus,
  type OrchestratorConfig,
  type InspectResult,
  type CreateJobResult,
  type StatusResult,
  type CreateJobArgs,
} from "./orchestrator-client";
import {
  invokeExecutorOnce as realInvokeExecutorOnce,
  type ExecutorConfig,
  type ExecutorInvocationResult,
} from "./executor-client";
import { runBackfillLoop, DEFAULT_DELAY_MS, DEFAULT_MAX_CONSECUTIVE_IDLE, type RunLoopOutcome } from "./loop";

export interface RunCliDeps {
  readEnv: () => RunnerEnv;
  assertDevProjectRef: (url: string) => void;
  inspectAccount: (config: OrchestratorConfig, args: { clientId: string; adAccountRef: string }) => Promise<InspectResult>;
  createJob: (config: OrchestratorConfig, args: CreateJobArgs) => Promise<CreateJobResult>;
  getJobStatus: (config: OrchestratorConfig, args: { jobId: string }) => Promise<StatusResult>;
  invokeExecutorOnce: (config: ExecutorConfig, args: { jobId: string }) => Promise<ExecutorInvocationResult>;
  sleep: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export const realRunCliDeps: RunCliDeps = {
  readEnv: readRunnerEnv,
  assertDevProjectRef,
  inspectAccount: realInspectAccount,
  createJob: realCreateJob,
  getJobStatus: realGetJobStatus,
  invokeExecutorOnce: realInvokeExecutorOnce,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
};

/**
 * Orquestra 1 execução do CLI. Devolve o exit code (0 = ok, 1 = erro
 * tratado). TODA operação com efeito colateral vem de `deps` — nenhuma
 * chamada de rede/env/console direta aqui, exceto através de `deps`.
 */
export async function runCli(argv: readonly string[], deps: RunCliDeps): Promise<number> {
  let args: ParsedRunArgs;
  try {
    args = parseRunArgs(argv);
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let env: RunnerEnv;
  try {
    env = deps.readEnv();
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  // DEV ONLY — antes de QUALQUER chamada de rede.
  try {
    deps.assertDevProjectRef(env.orchestratorUrl);
    deps.assertDevProjectRef(env.executorUrl);
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  deps.log(`TARGET PROJECT: ${env.orchestratorUrl}`);
  deps.log(`TARGET PROJECT (executor): ${env.executorUrl}`);

  const orchestratorConfig: OrchestratorConfig = { baseUrl: env.orchestratorUrl, secret: env.orchestratorSecret };
  const executorConfig: ExecutorConfig = { baseUrl: env.executorUrl, secret: env.executorSecret };

  const runLoopFor = (jobId: string): Promise<RunLoopOutcome> =>
    runBackfillLoop(
      {
        getStatus: () => deps.getJobStatus(orchestratorConfig, { jobId }),
        invokeExecutor: () => deps.invokeExecutorOnce(executorConfig, { jobId }),
        sleep: deps.sleep,
        log: deps.log,
      },
      { delayMs: DEFAULT_DELAY_MS, maxConsecutiveIdle: DEFAULT_MAX_CONSECUTIVE_IDLE },
    );

  if (args.mode === "resume") {
    deps.log(`--resume ${args.jobId}: NÃO cria job novo — retomando o loop de execução.`);
    const outcome = await runLoopFor(args.jobId);
    deps.log("Desfecho:", outcome);
    return 0;
  }

  const inspection = await deps.inspectAccount(orchestratorConfig, {
    clientId: args.clientId,
    adAccountRef: args.adAccountRef,
  });

  if (inspection.activeJob) {
    deps.error(
      `Já existe um job ativo para esta conta (jobId=${inspection.jobId}). Use --resume ${inspection.jobId} para continuar, ou aguarde ele terminar antes de criar outro.`,
    );
    return 1;
  }
  if (!inspection.connectionEligible) {
    deps.error(
      `Conexão não elegível para backfill (status=${inspection.connectionStatus}). Precisa estar active ou expiring, com secret presente.`,
    );
    return 1;
  }

  const hints: EntityCountHints = {
    campaigns: inspection.entityCounts.campaign,
    adsets: inspection.entityCounts.adset,
    ads: inspection.entityCounts.ad,
  };
  const plan = planBackfillSegments({
    jobId: "dry-run-local", // puro/local — nada é persistido a partir daqui
    requestedLevels: args.levels,
    targetStartDate: args.from,
    targetEndDate: args.to,
    resolvedEarliestDate: null,
    entityHints: hints,
  });

  if (plan.requiresDiscovery) {
    // não deveria acontecer com --from explícito (parseRunArgs já garante isso) — defensivo.
    deps.error("Planner pediu discovery inesperadamente (bug?) — abortando sem criar nada.");
    return 1;
  }

  deps.log(`Conta: ${inspection.metaAccountId} (conexão ${inspection.connectionStatus})`);
  deps.log(`Período: ${args.from} a ${args.to}`);
  deps.log(`Levels: ${args.levels.join(", ")}`);
  const byLevel = new Map<string, number>();
  for (const seg of plan.segments) byLevel.set(seg.level, (byLevel.get(seg.level) ?? 0) + 1);
  for (const [level, count] of byLevel) {
    deps.log(`  ${level}: ${count} segmento(s)`);
  }
  deps.log(`Total: ${plan.segments.length} segmento(s).`);

  if (args.mode === "dry-run") {
    deps.log("\nDRY-RUN — nenhum job criado, nenhuma chamada ao executor, nenhuma chamada à Meta.");
    deps.log("Use --execute para rodar de verdade.");
    return 0;
  }

  const created = await deps.createJob(orchestratorConfig, {
    clientId: args.clientId,
    adAccountRef: args.adAccountRef,
    requestedLevels: args.levels,
    targetStartDate: args.from,
    targetEndDate: args.to,
    segments: plan.segments,
  });
  deps.log(`Job criado: ${created.jobId} (${created.segmentCount} segmentos).`);

  const outcome = await runLoopFor(created.jobId);
  deps.log("Desfecho:", outcome);
  return 0;
}

// Só executa de verdade quando este arquivo É o entrypoint (nunca quando um
// teste faz `import { runCli } from "./run"`).
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  runCli(process.argv.slice(2), realRunCliDeps)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof CliArgsError || err instanceof RunnerEnvError || err instanceof DevOnlyGuardError) {
        console.error(err.message);
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      process.exitCode = 1;
    });
}
