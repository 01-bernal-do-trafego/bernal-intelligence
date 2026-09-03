/**
 * Parse-guards dos entrypoints Deno (fora do tsconfig/eslint). Garante que a
 * distinção "skip esperado" vs "erro inesperado de acquire" está nos dois
 * caminhos e que nenhuma mensagem SQL bruta vaza na resposta.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../supabase/functions/${p}`, import.meta.url)), "utf8");

const core = read("_shared/sync-core.ts");
const scheduled = read("meta-sync-scheduled/index.ts");
const manual = read("meta-sync/index.ts");

describe("sync-core.ts — classificação do acquire", () => {
  it("sync_already_running e no_eligible_account são skip:true", () => {
    expect(core).toMatch(/reason:\s*"sync_already_running",\s*skip:\s*true/);
    expect(core).toMatch(/reason:\s*"no_eligible_account",\s*skip:\s*true/);
  });
  it("erro inesperado -> acquire_failed, skip:false, phase:\"acquire\"", () => {
    expect(core).toMatch(
      /reason:\s*"acquire_failed",\s*\n?\s*skip:\s*false,\s*\n?\s*phase:\s*"acquire"/,
    );
  });
  it("só o SQLSTATE (5 chars) é propagado — nunca message/details/hint", () => {
    expect(core).toMatch(/\/\^\[0-9A-Za-z\]\{5\}\$\/\.test\(rawCode\)/);
    // acqErr.message aparece só na linha de match (comentada como não-retornada)
    const msgHits = core.match(/acqErr\.message/g) ?? [];
    expect(msgHits).toHaveLength(1);
    expect(core).not.toMatch(/acqErr\.details|acqErr\.hint/);
  });
});

describe("meta-sync-scheduled — HTTP", () => {
  it("skip esperado -> 200 status:skipped", () => {
    expect(scheduled).toMatch(/if\s*\(\s*result\.skip\s*\)/);
    expect(scheduled).toMatch(/status:\s*"skipped"[\s\S]*?\},\s*200\s*\)/);
  });
  it("erro inesperado -> 500 status:error", () => {
    expect(scheduled).toMatch(/status:\s*"error"[\s\S]*?\},\s*\n?\s*500,?\s*\n?\s*\)/);
  });
  it("resposta de erro carrega phase/code opcionais, não SQL", () => {
    expect(scheduled).toMatch(/result\.phase\s*\?\s*\{\s*phase:\s*result\.phase\s*\}/);
    expect(scheduled).toMatch(/result\.code\s*\?\s*\{\s*code:\s*result\.code\s*\}/);
    expect(scheduled).not.toMatch(/result\.(message|error_text|details)/);
  });
});

describe("meta-sync (manual) — HTTP", () => {
  it("skip esperado -> 409 (erro real, não 200)", () => {
    expect(manual).toMatch(/if\s*\(\s*result\.skip\s*\)/);
    expect(manual).toMatch(/error:\s*result\.reason\s*\?\?\s*"sync_conflict"\s*\}\s*,\s*409\s*\)/);
  });
  it("erro inesperado de acquire -> 500 sanitizado", () => {
    expect(manual).toMatch(/error:\s*result\.reason\s*\?\?\s*"acquire_failed"[\s\S]*?\},\s*\n?\s*500,?\s*\n?\s*\)/);
    expect(manual).not.toMatch(/409\s*:\s*409/); // ternário morto removido
  });
});
