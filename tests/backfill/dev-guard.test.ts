import { describe, expect, it } from "vitest";
import {
  DEV_PROJECT_REF,
  DevOnlyGuardError,
  PROHIBITED_PROD_PROJECT_REF,
  assertDevProjectRef,
  extractProjectRef,
} from "../../scripts/backfill/dev-guard";

describe("extractProjectRef", () => {
  it("extrai o ref de uma URL do Supabase", () => {
    expect(extractProjectRef(`https://${DEV_PROJECT_REF}.supabase.co`)).toBe(DEV_PROJECT_REF);
  });
  it("extrai o ref mesmo com path (ex.: functions/v1/...)", () => {
    expect(extractProjectRef(`https://${DEV_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-orchestrator`)).toBe(
      DEV_PROJECT_REF,
    );
  });
  it("devolve null para URL que não bate com o formato", () => {
    expect(extractProjectRef("https://example.com")).toBeNull();
  });
});

describe("assertDevProjectRef — Prod ref aborta", () => {
  it(`lança DevOnlyGuardError para ${PROHIBITED_PROD_PROJECT_REF} (Prod), com mensagem mencionando PRODUÇÃO`, () => {
    expect(() => assertDevProjectRef(`https://${PROHIBITED_PROD_PROJECT_REF}.supabase.co`)).toThrow(DevOnlyGuardError);
    try {
      assertDevProjectRef(`https://${PROHIBITED_PROD_PROJECT_REF}.supabase.co`);
    } catch (e) {
      expect((e as Error).message).toMatch(/PRODUÇÃO/);
    }
  });
});

describe("assertDevProjectRef — Dev ref aceita", () => {
  it(`NÃO lança para ${DEV_PROJECT_REF} (Dev)`, () => {
    expect(() => assertDevProjectRef(`https://${DEV_PROJECT_REF}.supabase.co/functions/v1/x`)).not.toThrow();
  });
});

describe("assertDevProjectRef — qualquer outro ref desconhecido também aborta", () => {
  it("lança para um ref qualquer que não seja o Dev conhecido", () => {
    expect(() => assertDevProjectRef("https://outroref123.supabase.co")).toThrow(DevOnlyGuardError);
  });
  it("lança para uma URL que nem bate o formato Supabase", () => {
    expect(() => assertDevProjectRef("https://minha-api-qualquer.com")).toThrow(DevOnlyGuardError);
  });
});
