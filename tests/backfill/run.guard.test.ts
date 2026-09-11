/**
 * Guardas ESTÁTICAS de `scripts/backfill/run.ts` e `scripts/backfill/cli-args.ts`
 * (DATA V2.3A) — invariantes que fazem mais sentido conferidas por leitura de
 * texto do que por comportamento (import real do planner, ausência de
 * handler de SIGINT, secrets nunca aceitos via CLI).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const runSrc = read("../../scripts/backfill/run.ts");
const cliArgsSrc = read("../../scripts/backfill/cli-args.ts");

describe("planner existente REALMENTE importado (nenhuma cópia do algoritmo)", () => {
  it("importa planBackfillSegments de @/lib/backfill/planner", () => {
    expect(runSrc).toMatch(/import\s*\{\s*planBackfillSegments\s*\}\s*from\s*["']@\/lib\/backfill\/planner["']/);
  });
  it("NÃO define uma função própria chamada planBackfillSegments/resolveBlockSizeDays", () => {
    expect(runSrc).not.toMatch(/function\s+planBackfillSegments/);
    expect(runSrc).not.toMatch(/function\s+resolveBlockSizeDays/);
  });
});

describe("Ctrl-C não cancela job — nenhum handler de SIGINT toca o job", () => {
  it("run.ts não registra process.on/process.once para SIGINT/SIGTERM", () => {
    expect(runSrc).not.toMatch(/process\.(on|once)\(\s*["'](SIGINT|SIGTERM)["']/);
  });
});

describe("secrets nunca aceitos via argumento de CLI", () => {
  it("cli-args.ts só reconhece os flags documentados (client-id, ad-account-ref, from, to, levels, execute, resume) — nenhum flag de secret", () => {
    const flags = [...cliArgsSrc.matchAll(/getFlagValue\(argv, "(--[\w-]+)"\)|hasFlag\(argv, "(--[\w-]+)"\)/g)]
      .map((m) => m[1] ?? m[2]);
    const allowed = new Set(["--resume", "--client-id", "--ad-account-ref", "--from", "--to", "--levels", "--execute"]);
    for (const flag of flags) {
      expect(allowed.has(flag), `flag inesperado em cli-args.ts: ${flag}`).toBe(true);
    }
    expect(flags).not.toContain("--secret");
    expect(flags.some((f) => f.includes("secret"))).toBe(false);
  });
  it("run.ts lê secrets SÓ via readEnv()/deps.readEnv() — nunca de argv/process.argv diretamente para secret", () => {
    // a única leitura de argv em run.ts é process.argv.slice(2), repassada ao parser — nunca indexada à mão para "secret".
    expect(runSrc).not.toMatch(/argv\[.*secret/i);
  });
});

describe("secrets nunca logados — nenhuma chamada log()/console.log inclui as variáveis de secret", () => {
  it("nenhuma linha de log formata orchestratorSecret/executorSecret/env.*Secret", () => {
    const logLines = [...runSrc.matchAll(/deps\.(log|error)\([^)]*\)/g)].map((m) => m[0]);
    for (const line of logLines) {
      expect(line).not.toMatch(/Secret\b/);
    }
  });
});

describe("dry-run é o padrão de segurança — --execute precisa ser explícito", () => {
  it('mode default é "dry-run", só vira "execute" com hasFlag(argv, "--execute")', () => {
    expect(cliArgsSrc).toMatch(/mode:\s*hasFlag\(argv, "--execute"\)\s*\?\s*"execute"\s*:\s*"dry-run"/);
  });
});

describe("rollout sequencial — sem paralelismo entre contas/segmentos", () => {
  it("runCli não tem nenhum Promise.all/paralelismo chamando invokeExecutorOnce mais de uma vez por vez", () => {
    expect(runSrc).not.toMatch(/Promise\.all\([^)]*invokeExecutorOnce/);
  });
});
