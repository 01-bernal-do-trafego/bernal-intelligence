/**
 * DATA V2.3A/V2.3B — Historical Backfill Rollout. Leitura de env do runner.
 *
 * SOMENTE env — nenhum secret é aceito via argumento de CLI (ver
 * `cli-args.ts`), nenhum secret é impresso (nenhum destes valores passa por
 * `console.log`/`log()` em nenhum lugar do runner).
 *
 * `BACKFILL_DISCOVERY_URL`/`META_BACKFILL_DISCOVERY_SECRET` são opcionais
 * aqui — só passam a ser exigidos quando o modo `--all-history` é usado
 * (checado em `run.ts`, não aqui) — o modo explícito `--from`/`--to` (V2.3A)
 * continua funcionando sem essas 2 variáveis configuradas.
 */

export interface RunnerEnv {
  orchestratorUrl: string;
  orchestratorSecret: string;
  executorUrl: string;
  executorSecret: string;
  discoveryUrl: string | null;
  discoverySecret: string | null;
}

const REQUIRED_VARS = [
  "BACKFILL_ORCHESTRATOR_URL",
  "META_BACKFILL_ORCHESTRATOR_SECRET",
  "BACKFILL_EXECUTOR_URL",
  "META_BACKFILL_EXECUTOR_SECRET",
] as const;

export class RunnerEnvError extends Error {}

/** Lê e valida as 4 variáveis obrigatórias (+ 2 opcionais de discovery). Lança `RunnerEnvError` (nome da var, nunca o valor) se alguma obrigatória faltar. */
export function readRunnerEnv(env: Readonly<Record<string, string | undefined>> = process.env): RunnerEnv {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new RunnerEnvError(`Variáveis de ambiente ausentes: ${missing.join(", ")} (nunca aceitas via argumento de CLI)`);
  }
  return {
    orchestratorUrl: env.BACKFILL_ORCHESTRATOR_URL as string,
    orchestratorSecret: env.META_BACKFILL_ORCHESTRATOR_SECRET as string,
    executorUrl: env.BACKFILL_EXECUTOR_URL as string,
    executorSecret: env.META_BACKFILL_EXECUTOR_SECRET as string,
    discoveryUrl: env.BACKFILL_DISCOVERY_URL ?? null,
    discoverySecret: env.META_BACKFILL_DISCOVERY_SECRET ?? null,
  };
}

/** Exigido só quando `--all-history` é usado. Lança `RunnerEnvError` citando os NOMES ausentes, nunca um valor. */
export function requireDiscoveryEnv(env: RunnerEnv): { discoveryUrl: string; discoverySecret: string } {
  const missing: string[] = [];
  if (!env.discoveryUrl) missing.push("BACKFILL_DISCOVERY_URL");
  if (!env.discoverySecret) missing.push("META_BACKFILL_DISCOVERY_SECRET");
  if (missing.length > 0) {
    throw new RunnerEnvError(
      `--all-history precisa de: ${missing.join(", ")} (nunca aceitas via argumento de CLI)`,
    );
  }
  return { discoveryUrl: env.discoveryUrl as string, discoverySecret: env.discoverySecret as string };
}
