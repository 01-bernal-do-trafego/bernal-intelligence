import { describe, expect, it } from "vitest";
import { readRunnerEnv, RunnerEnvError } from "../../scripts/backfill/env";

const FULL_ENV = {
  BACKFILL_ORCHESTRATOR_URL: "https://x.supabase.co/functions/v1/meta-backfill-orchestrator",
  META_BACKFILL_ORCHESTRATOR_SECRET: "orch-secret",
  BACKFILL_EXECUTOR_URL: "https://x.supabase.co/functions/v1/meta-backfill-executor",
  META_BACKFILL_EXECUTOR_SECRET: "exec-secret",
};

describe("readRunnerEnv", () => {
  it("lê as 4 variáveis obrigatórias", () => {
    const env = readRunnerEnv(FULL_ENV);
    expect(env).toEqual({
      orchestratorUrl: FULL_ENV.BACKFILL_ORCHESTRATOR_URL,
      orchestratorSecret: FULL_ENV.META_BACKFILL_ORCHESTRATOR_SECRET,
      executorUrl: FULL_ENV.BACKFILL_EXECUTOR_URL,
      executorSecret: FULL_ENV.META_BACKFILL_EXECUTOR_SECRET,
    });
  });

  it("falta qualquer uma das 4 -> RunnerEnvError citando o NOME da variável (nunca um valor)", () => {
    const partial = { ...FULL_ENV, META_BACKFILL_EXECUTOR_SECRET: undefined };
    expect(() => readRunnerEnv(partial)).toThrow(RunnerEnvError);
    try {
      readRunnerEnv(partial);
    } catch (e) {
      expect((e as Error).message).toContain("META_BACKFILL_EXECUTOR_SECRET");
      expect((e as Error).message).not.toContain(FULL_ENV.META_BACKFILL_ORCHESTRATOR_SECRET);
    }
  });

  it("nenhum valor de secret aparece na mensagem de erro quando tudo falta", () => {
    try {
      readRunnerEnv({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("BACKFILL_ORCHESTRATOR_URL");
      expect(msg).toContain("META_BACKFILL_ORCHESTRATOR_SECRET");
    }
  });
});
