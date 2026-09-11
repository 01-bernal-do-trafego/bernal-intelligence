/**
 * DATA V2.3A — Historical Backfill Rollout. Leitura de env do runner.
 *
 * SOMENTE env — nenhum secret é aceito via argumento de CLI (ver
 * `cli-args.ts`), nenhum secret é impresso (nenhum destes valores passa por
 * `console.log`/`log()` em nenhum lugar do runner).
 */

export interface RunnerEnv {
  orchestratorUrl: string;
  orchestratorSecret: string;
  executorUrl: string;
  executorSecret: string;
}

const REQUIRED_VARS = [
  "BACKFILL_ORCHESTRATOR_URL",
  "META_BACKFILL_ORCHESTRATOR_SECRET",
  "BACKFILL_EXECUTOR_URL",
  "META_BACKFILL_EXECUTOR_SECRET",
] as const;

export class RunnerEnvError extends Error {}

/** Lê e valida as 4 variáveis obrigatórias. Lança `RunnerEnvError` (nome da var, nunca o valor) se alguma faltar. */
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
  };
}
