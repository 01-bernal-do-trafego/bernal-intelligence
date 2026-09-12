import { describe, expect, it } from "vitest";
import { readRunnerEnv, requireDiscoveryEnv, RunnerEnvError } from "../../scripts/backfill/env";

const FULL_ENV = {
  BACKFILL_ORCHESTRATOR_URL: "https://x.supabase.co/functions/v1/meta-backfill-orchestrator",
  META_BACKFILL_ORCHESTRATOR_SECRET: "orch-secret",
  BACKFILL_EXECUTOR_URL: "https://x.supabase.co/functions/v1/meta-backfill-executor",
  META_BACKFILL_EXECUTOR_SECRET: "exec-secret",
};
const FULL_ENV_WITH_DISCOVERY = {
  ...FULL_ENV,
  BACKFILL_DISCOVERY_URL: "https://x.supabase.co/functions/v1/meta-backfill-discovery",
  META_BACKFILL_DISCOVERY_SECRET: "disc-secret",
};

describe("readRunnerEnv", () => {
  it("lê as 4 variáveis obrigatórias; discovery vem null se ausente (modo explícito não precisa delas)", () => {
    const env = readRunnerEnv(FULL_ENV);
    expect(env).toEqual({
      orchestratorUrl: FULL_ENV.BACKFILL_ORCHESTRATOR_URL,
      orchestratorSecret: FULL_ENV.META_BACKFILL_ORCHESTRATOR_SECRET,
      executorUrl: FULL_ENV.BACKFILL_EXECUTOR_URL,
      executorSecret: FULL_ENV.META_BACKFILL_EXECUTOR_SECRET,
      discoveryUrl: null,
      discoverySecret: null,
    });
  });

  it("com as 2 vars de discovery presentes, também são lidas", () => {
    const env = readRunnerEnv(FULL_ENV_WITH_DISCOVERY);
    expect(env.discoveryUrl).toBe(FULL_ENV_WITH_DISCOVERY.BACKFILL_DISCOVERY_URL);
    expect(env.discoverySecret).toBe(FULL_ENV_WITH_DISCOVERY.META_BACKFILL_DISCOVERY_SECRET);
  });

  it("falta qualquer uma das 4 obrigatórias -> RunnerEnvError citando o NOME da variável (nunca um valor)", () => {
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

  it("ausência das 2 vars de discovery NÃO afeta o modo explícito (nunca lança por causa delas)", () => {
    expect(() => readRunnerEnv(FULL_ENV)).not.toThrow();
  });
});

describe("requireDiscoveryEnv — só exigido quando --all-history é usado", () => {
  it("com as 2 vars presentes, devolve discoveryUrl/discoverySecret", () => {
    const env = readRunnerEnv(FULL_ENV_WITH_DISCOVERY);
    expect(requireDiscoveryEnv(env)).toEqual({
      discoveryUrl: FULL_ENV_WITH_DISCOVERY.BACKFILL_DISCOVERY_URL,
      discoverySecret: FULL_ENV_WITH_DISCOVERY.META_BACKFILL_DISCOVERY_SECRET,
    });
  });

  it("faltando as 2 -> RunnerEnvError citando os NOMES, nunca um valor", () => {
    const env = readRunnerEnv(FULL_ENV);
    expect(() => requireDiscoveryEnv(env)).toThrow(RunnerEnvError);
    try {
      requireDiscoveryEnv(env);
    } catch (e) {
      expect((e as Error).message).toContain("BACKFILL_DISCOVERY_URL");
      expect((e as Error).message).toContain("META_BACKFILL_DISCOVERY_SECRET");
    }
  });

  it("faltando só uma delas -> RunnerEnvError cita só a que falta", () => {
    const env = readRunnerEnv({ ...FULL_ENV_WITH_DISCOVERY, META_BACKFILL_DISCOVERY_SECRET: undefined });
    try {
      requireDiscoveryEnv(env);
    } catch (e) {
      expect((e as Error).message).toContain("META_BACKFILL_DISCOVERY_SECRET");
      expect((e as Error).message).not.toContain("BACKFILL_DISCOVERY_URL,");
    }
  });
});
