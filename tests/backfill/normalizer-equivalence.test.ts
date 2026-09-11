/**
 * DATA V2.2.3 — prova de EQUIVALÊNCIA Current Sync × Backfill (seção 22).
 *
 * "Criar fixture, passar pelos dois caminhos, comparar" — TENTADO nesta
 * etapa e descartado por um motivo concreto, documentado aqui (não por
 * preguiça):
 *
 *   `_shared/insights.ts`/`_shared/actions.ts` (o normalizador REAL, usado
 *   por `sync-core.ts` E por `meta-backfill-executor/index.ts`) não usam
 *   NENHUMA API específica do Deno — são TypeScript puro, e o Vitest
 *   CONSEGUE importá-los e executá-los diretamente (confirmado numa prova
 *   isolada). MAS o `tsc --noEmit` do projeto (via `npm run typecheck`)
 *   FALHA nessa importação: `supabase/functions` está fora do `include` do
 *   `tsconfig.json` (fronteira Deno/Next deliberada) e os arquivos ali usam
 *   import com extensão `.ts` explícita (exigido pelo Deno) — o que dispara
 *   `TS5097: An import path can only end with a '.ts' extension when
 *   'allowImportingTsExtensions' is enabled` assim que QUALQUER arquivo de
 *   dentro do `include` (como um teste em `tests/`) importa algo de lá,
 *   direto ou dinâmico (`import()` — testado, mesmo erro).
 *
 *   Corrigir isso exigiria mudar `tsconfig.json` (uma config GLOBAL e
 *   compartilhada) só para viabilizar ESTE teste — fora do escopo pedido
 *   nesta etapa (nenhuma alteração de config foi solicitada) e um efeito
 *   colateral maior do que o valor do teste. Por isso: NÃO alterado.
 *
 * O que ESTE arquivo prova, de forma honesta e sem tocar tsconfig:
 *   1. `sync-core.ts` (Current Sync) e `meta-backfill-executor/index.ts`
 *      (Backfill) importam `toDailyRows` do MESMO arquivo — não existem
 *      DOIS normalizadores para divergir silenciosamente (guarda estática,
 *      leitura de texto, sem cruzar a fronteira de compilação);
 *   2. `lib/backfill/insight-row.ts#BackfillInsightRow` — o tipo que o
 *      executor espera — é estruturalmente IDÊNTICO ao `DailyInsightRow`
 *      que `toDailyRows` realmente produz (comparação campo a campo contra
 *      o código-fonte de `insights.ts`, não um "achismo").
 *
 * Se uma prova de execução real (fixture -> toDailyRows -> asserts) for
 * desejada no futuro, o caminho é uma decisão EXPLÍCITA de habilitar
 * `allowImportingTsExtensions` no `tsconfig.json` (compatível com
 * `noEmit: true` já presente) — não decidida aqui.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

describe("Current Sync e Backfill importam o MESMO toDailyRows — nunca dois normalizadores", () => {
  it("sync-core.ts importa toDailyRows de ./insights.ts", () => {
    const src = read("../../supabase/functions/_shared/sync-core.ts");
    expect(src).toMatch(/import\s*\{[^}]*toDailyRows[^}]*\}\s*from\s*["']\.\/insights\.ts["']/);
  });
  it("meta-backfill-executor/index.ts importa toDailyRows de ../_shared/insights.ts (MESMO arquivo)", () => {
    const src = read("../../supabase/functions/meta-backfill-executor/index.ts");
    expect(src).toMatch(/import\s*\{[^}]*toDailyRows[^}]*\}\s*from\s*["']\.\.\/_shared\/insights\.ts["']/);
  });
  it("meta-backfill-executor/index.ts NÃO define nenhuma função própria chamada toDailyRows/normalizeActions", () => {
    const src = read("../../supabase/functions/meta-backfill-executor/index.ts");
    expect(src).not.toMatch(/function\s+toDailyRows/);
    expect(src).not.toMatch(/function\s+normalizeActions/);
  });
});

describe("BackfillInsightRow (lib/backfill/insight-row.ts) é estruturalmente igual a DailyInsightRow (_shared/insights.ts)", () => {
  it("os mesmos 21 campos, na mesma forma (comparação campo a campo contra o código-fonte)", () => {
    const insightsSrc = read("../../supabase/functions/_shared/insights.ts");
    const dbRowBlock = insightsSrc.slice(
      insightsSrc.indexOf("export interface DbInsightRow"),
      insightsSrc.indexOf("export interface DailyInsightRow"),
    );
    // campos declarados em DbInsightRow (nome antes de ":", ignorando chaves/linhas em branco).
    const denoFields = [...dbRowBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();

    const rowTypeSrc = read("../../lib/backfill/insight-row.ts");
    const rowBlock = rowTypeSrc.slice(
      rowTypeSrc.indexOf("export interface BackfillInsightRow"),
      rowTypeSrc.indexOf("/** Mesma natural key"),
    );
    const backfillFields = [...rowBlock.matchAll(/^\s*(\w+):/gm)]
      .map((m) => m[1])
      .filter((f) => f !== "date") // "date" só existe em DailyInsightRow (extends DbInsightRow), não em DbInsightRow base
      .sort();

    expect(backfillFields).toEqual(denoFields);
  });
});
