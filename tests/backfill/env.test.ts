import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readRunnerEnv, requireDiscoveryEnv, RunnerEnvError } from "../../scripts/backfill/env";

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

/* ================= PROD SAFETY — .env.backfill.<environment>.local ================= */

describe("loadEnvironmentFile — .env.backfill.<environment>.local (PASSO 4)", () => {
  let dir: string;
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "backfill-env-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // restaura process.env exatamente como estava — nenhum teste vaza var para outro.
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL);
  });

  it("arquivo ausente -> não lança, não muda process.env (fluxo atual de export manual continua igual)", () => {
    delete process.env.BACKFILL_TEST_VAR;
    expect(() => loadEnvironmentFile("dev", dir)).not.toThrow();
    expect(process.env.BACKFILL_TEST_VAR).toBeUndefined();
  });

  it("arquivo .env.backfill.dev.local presente -> carrega as variáveis dele", () => {
    delete process.env.BACKFILL_TEST_VAR;
    writeFileSync(join(dir, ".env.backfill.dev.local"), "BACKFILL_TEST_VAR=from-dev-file\n");
    loadEnvironmentFile("dev", dir);
    expect(process.env.BACKFILL_TEST_VAR).toBe("from-dev-file");
  });

  it("arquivo .env.backfill.prod.local presente -> carrega as variáveis dele (arquivo separado do dev)", () => {
    delete process.env.BACKFILL_TEST_VAR;
    writeFileSync(join(dir, ".env.backfill.prod.local"), "BACKFILL_TEST_VAR=from-prod-file\n");
    loadEnvironmentFile("prod", dir);
    expect(process.env.BACKFILL_TEST_VAR).toBe("from-prod-file");
  });

  it("environment='dev' NUNCA lê o arquivo de prod, e vice-versa", () => {
    writeFileSync(join(dir, ".env.backfill.dev.local"), "BACKFILL_TEST_VAR=dev-value\n");
    writeFileSync(join(dir, ".env.backfill.prod.local"), "BACKFILL_TEST_VAR=prod-value\n");
    delete process.env.BACKFILL_TEST_VAR;
    loadEnvironmentFile("dev", dir);
    expect(process.env.BACKFILL_TEST_VAR).toBe("dev-value");
  });

  it("variável já setada no processo (shell exportado) NUNCA é sobrescrita pelo arquivo", () => {
    process.env.BACKFILL_TEST_VAR = "from-shell";
    writeFileSync(join(dir, ".env.backfill.dev.local"), "BACKFILL_TEST_VAR=from-file\n");
    loadEnvironmentFile("dev", dir);
    expect(process.env.BACKFILL_TEST_VAR).toBe("from-shell");
  });
});
