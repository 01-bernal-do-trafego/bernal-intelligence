#!/usr/bin/env -S npx tsx
/**
 * DATA V2.3A/V2.3B — Historical Backfill Rollout. Runner administrativo (CLI).
 * ---------------------------------------------------------------------------
 * Uma única operação manual para rodar um job de backfill inteiro, sem tocar
 * no SQL Editor.
 *
 * INTERVALO EXPLÍCITO (V2.3A):
 *   npm run backfill -- --client-id <uuid> --ad-account-ref <uuid> \
 *     --from 2026-08-01 --to 2026-09-10 --levels account,campaign,adset,ad
 *
 * FULL HISTORY (V2.3B) — descobre o intervalo automaticamente via
 * `meta-backfill-discovery`, sem precisar informar `--from`:
 *   npm run backfill -- --client-id <uuid> --ad-account-ref <uuid> \
 *     --levels account,campaign,adset,ad --all-history
 *
 * `--all-history` e `--from`/`--to` são MUTUAMENTE EXCLUSIVOS
 * (`cli-args.ts`). Sem nenhum dos dois, o runner recusa — nunca inventa uma
 * data (preserva `targetStartDate=null -> requiresDiscovery` do planner).
 *
 * SEM `--execute`: DRY-RUN (padrão de segurança) — [discovery, se
 * `--all-history`] → `inspect` → planner LOCAL
 * (`lib/backfill/planner.ts#planBackfillSegments`, a ÚNICA fonte de verdade
 * de segmentação — nenhuma cópia do algoritmo aqui) → imprime o plano. NÃO
 * cria job, NÃO chama o executor. Com `--all-history`, a mensagem final NÃO
 * diz "nenhuma chamada Meta" (Discovery chamou a Meta de verdade para
 * descobrir o histórico) — diz que nenhum job/segmento foi criado/executado.
 *
 * COM `--execute`: [discovery] → inspect → planner → guarda de volume
 * (`MAX_PLANNED_SEGMENTS`) → `create` (via orchestrator, RPC atômica) →
 * loop (`./loop.ts#runBackfillLoop`, MESMO loop da V2.3A) chamando o
 * executor 1 segmento por vez até um desfecho terminal ou uma guarda de
 * segurança.
 *
 *   npm run backfill -- --resume <jobId>
 *
 * NÃO roda discovery, NÃO cria outro job — só retoma o loop de execução de
 * um job já existente. Ctrl-C não cancela nada (nenhum handler de SIGINT
 * toca o job) — o job fica exatamente como estava, persistido no banco.
 *
 * SECRETS: só de env (`./env.ts`) — `BACKFILL_ORCHESTRATOR_URL`,
 * `META_BACKFILL_ORCHESTRATOR_SECRET`, `BACKFILL_EXECUTOR_URL`,
 * `META_BACKFILL_EXECUTOR_SECRET` (sempre) + `BACKFILL_DISCOVERY_URL`,
 * `META_BACKFILL_DISCOVERY_SECRET` (só quando `--all-history`). NUNCA
 * aceitos via argumento de CLI, NUNCA impressos.
 *
 * DEV ONLY: `./dev-guard.ts#assertDevProjectRef` recusa qualquer
 * project-ref que não seja o Supabase Dev conhecido — em especial o de
 * Prod, por nome. Checado para orchestrator/executor sempre, e também para
 * discovery quando `--all-history` é usado — sempre ANTES de qualquer
 * chamada de rede.
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
import { readRunnerEnv, requireDiscoveryEnv, RunnerEnvError, type RunnerEnv } from "./env";
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
import {
  discoverAccountHistory as realDiscoverAccountHistory,
  type DiscoveryConfig,
  type DiscoveryResult,
} from "./discovery-client";
import { runBackfillLoop, DEFAULT_DELAY_MS, DEFAULT_MAX_CONSECUTIVE_IDLE, type RunLoopOutcome } from "./loop";
import { MAX_PLANNED_SEGMENTS, exceedsMaxPlannedSegments } from "./segment-limits";

export interface RunCliDeps {
  readEnv: () => RunnerEnv;
  requireDiscoveryEnv: (env: RunnerEnv) => { discoveryUrl: string; discoverySecret: string };
  assertDevProjectRef: (url: string) => void;
  inspectAccount: (config: OrchestratorConfig, args: { clientId: string; adAccountRef: string }) => Promise<InspectResult>;
  createJob: (config: OrchestratorConfig, args: CreateJobArgs) => Promise<CreateJobResult>;
  getJobStatus: (config: OrchestratorConfig, args: { jobId: string }) => Promise<StatusResult>;
  invokeExecutorOnce: (config: ExecutorConfig, args: { jobId: string }) => Promise<ExecutorInvocationResult>;
  discoverAccountHistory: (config: DiscoveryConfig, args: { clientId: string; adAccountRef: string }) => Promise<DiscoveryResult>;
  sleep: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export const realRunCliDeps: RunCliDeps = {
  readEnv: readRunnerEnv,
  requireDiscoveryEnv,
  assertDevProjectRef,
  inspectAccount: realInspectAccount,
  createJob: realCreateJob,
  getJobStatus: realGetJobStatus,
  invokeExecutorOnce: realInvokeExecutorOnce,
  discoverAccountHistory: realDiscoverAccountHistory,
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
    deps.log(`--resume ${args.jobId}: NÃO cria job novo, NÃO roda discovery — retomando o loop de execução.`);
    const outcome = await runLoopFor(args.jobId);
    deps.log("Desfecho:", outcome);
    return 0;
  }

  // ---- discovery (só quando --all-history) ------------------------------
  let targetStartDate: string;
  let targetEndDate: string;
  const usedDiscovery = args.rangeMode === "all-history";

  if (args.rangeMode === "all-history") {
    let discoveryEnv: { discoveryUrl: string; discoverySecret: string };
    try {
      discoveryEnv = deps.requireDiscoveryEnv(env);
      deps.assertDevProjectRef(discoveryEnv.discoveryUrl);
    } catch (err) {
      deps.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    deps.log(`TARGET PROJECT (discovery): ${discoveryEnv.discoveryUrl}`);
    deps.log("Discovery: consultando a Meta para descobrir o intervalo histórico disponível...");

    const discoveryConfig: DiscoveryConfig = { baseUrl: discoveryEnv.discoveryUrl, secret: discoveryEnv.discoverySecret };
    const discovery = await deps.discoverAccountHistory(discoveryConfig, {
      clientId: args.clientId,
      adAccountRef: args.adAccountRef,
    });

    if (discovery.status === "no_history") {
      deps.log(
        `Discovery: no_history — nenhuma atividade encontrada entre ${discovery.accountCreatedDate} (criação da conta) e ${discovery.latestClosedDate} (último dia fechado).`,
      );
      deps.log("Nenhum job foi criado.");
      return 0;
    }

    targetStartDate = discovery.earliestDate;
    targetEndDate = discovery.latestClosedDate;
    deps.log(
      `Discovery: earliestDate=${discovery.earliestDate} latestClosedDate=${discovery.latestClosedDate} (timezone ${discovery.accountTimezone}, ${discovery.probesPerformed} probes, estratégia ${discovery.strategy}).`,
    );
  } else {
    targetStartDate = args.from;
    targetEndDate = args.to;
  }

  // ---- inspect ------------------------------------------------------------
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

  // ---- planner (SEMPRE o mesmo, literal — V2.3A e V2.3B convergem aqui) --
  const hints: EntityCountHints = {
    campaigns: inspection.entityCounts.campaign,
    adsets: inspection.entityCounts.adset,
    ads: inspection.entityCounts.ad,
  };
  const plan = planBackfillSegments({
    jobId: "dry-run-local", // puro/local — nada é persistido a partir daqui
    requestedLevels: args.levels,
    targetStartDate,
    targetEndDate,
    resolvedEarliestDate: null,
    entityHints: hints,
  });

  if (plan.requiresDiscovery) {
    // não deveria acontecer (targetStartDate sempre resolvido acima, explícito ou via discovery) — defensivo.
    deps.error("Planner pediu discovery inesperadamente (bug?) — abortando sem criar nada.");
    return 1;
  }

  deps.log(`Conta: ${inspection.metaAccountId} (conexão ${inspection.connectionStatus})`);
  deps.log(`Período: ${targetStartDate} a ${targetEndDate}${usedDiscovery ? " (descoberto via Discovery)" : ""}`);
  deps.log(`Levels: ${args.levels.join(", ")}`);
  const byLevel = new Map<string, number>();
  for (const seg of plan.segments) byLevel.set(seg.level, (byLevel.get(seg.level) ?? 0) + 1);
  for (const [level, count] of byLevel) {
    deps.log(`  ${level}: ${count} segmento(s)`);
  }
  deps.log(`Total: ${plan.segments.length} segmento(s).`);

  const overLimit = exceedsMaxPlannedSegments(plan.segments.length);
  if (overLimit) {
    deps.log(
      `AVISO: ${plan.segments.length} segmentos excede MAX_PLANNED_SEGMENTS=${MAX_PLANNED_SEGMENTS} — --execute recusaria criar este job.`,
    );
  }

  if (args.mode === "dry-run") {
    if (usedDiscovery) {
      deps.log("\nDRY-RUN — Discovery consultou a Meta. Nenhum job foi criado. Nenhum segmento de backfill foi executado.");
    } else {
      deps.log("\nDRY-RUN — nenhum job criado, nenhuma chamada ao executor, nenhuma chamada à Meta.");
    }
    deps.log("Use --execute para rodar de verdade.");
    return 0;
  }

  // ---- execute --------------------------------------------------------
  if (overLimit) {
    deps.error(
      `ABORTADO: ${plan.segments.length} segmentos excede MAX_PLANNED_SEGMENTS=${MAX_PLANNED_SEGMENTS}. Nenhum job criado. Considere rodar por level separadamente.`,
    );
    return 1;
  }

  const created = await deps.createJob(orchestratorConfig, {
    clientId: args.clientId,
    adAccountRef: args.adAccountRef,
    requestedLevels: args.levels,
    targetStartDate,
    targetEndDate,
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
