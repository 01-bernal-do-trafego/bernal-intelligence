import { describe, expect, it } from "vitest";
import {
  DEV_PROJECT_REF,
  EnvironmentGuardError,
  KNOWN_ENVIRONMENTS,
  PROD_PROJECT_REF,
  assertEnvironmentConfirmed,
  assertUrlMatchesEnvironment,
  extractProjectRef,
} from "../../scripts/backfill/environment-guard";

const DEV_URL = `https://${DEV_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-orchestrator`;
const PROD_URL = `https://${PROD_PROJECT_REF}.supabase.co/functions/v1/meta-backfill-orchestrator`;

describe("extractProjectRef", () => {
  it("extrai o ref de uma URL do Supabase", () => {
    expect(extractProjectRef(`https://${DEV_PROJECT_REF}.supabase.co`)).toBe(DEV_PROJECT_REF);
  });
  it("extrai o ref mesmo com path (ex.: functions/v1/...)", () => {
    expect(extractProjectRef(DEV_URL)).toBe(DEV_PROJECT_REF);
  });
  it("devolve null para URL que não bate com o formato", () => {
    expect(extractProjectRef("https://example.com")).toBeNull();
  });
});

describe("KNOWN_ENVIRONMENTS — só dev e prod, nenhum modo genérico", () => {
  it("exatamente 2 ambientes conhecidos", () => {
    expect(KNOWN_ENVIRONMENTS).toEqual(["dev", "prod"]);
  });
});

/* ================= PASSO 1 — intenção do operador ================= */

describe("assertEnvironmentConfirmed — dev não exige confirmação (comportamento padrão inalterado)", () => {
  it("dev + confirmProjectRef null -> não lança", () => {
    expect(() => assertEnvironmentConfirmed("dev", null)).not.toThrow();
  });
  it("dev + qualquer confirmProjectRef (ignorado) -> não lança", () => {
    expect(() => assertEnvironmentConfirmed("dev", "qualquer-coisa")).not.toThrow();
  });
});

describe("assertEnvironmentConfirmed — prod SEM confirmação recusa", () => {
  it("prod + confirmProjectRef null -> EnvironmentGuardError", () => {
    expect(() => assertEnvironmentConfirmed("prod", null)).toThrow(EnvironmentGuardError);
  });
  it("mensagem explica que --confirm-project-ref é exigido, cita o ref esperado", () => {
    try {
      assertEnvironmentConfirmed("prod", null);
      throw new Error("deveria ter lançado");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvironmentGuardError);
      expect((e as Error).message).toContain(PROD_PROJECT_REF);
      expect((e as Error).message).toMatch(/confirm-project-ref/);
    }
  });
});

describe("assertEnvironmentConfirmed — prod com confirmação ERRADA recusa", () => {
  it("confirmProjectRef diferente do ref de Prod -> EnvironmentGuardError", () => {
    expect(() => assertEnvironmentConfirmed("prod", "algum-outro-ref")).toThrow(EnvironmentGuardError);
  });
  it("confirmProjectRef = ref de DEV (troca de ambiente) -> recusa", () => {
    expect(() => assertEnvironmentConfirmed("prod", DEV_PROJECT_REF)).toThrow(EnvironmentGuardError);
  });
  it("confirmProjectRef quase certo (1 char diferente) -> recusa (comparação exata, não prefixo)", () => {
    const almostRight = PROD_PROJECT_REF.slice(0, -1) + "x";
    expect(() => assertEnvironmentConfirmed("prod", almostRight)).toThrow(EnvironmentGuardError);
  });
});

describe("assertEnvironmentConfirmed — prod com confirmação CORRETA passa", () => {
  it("confirmProjectRef === PROD_PROJECT_REF -> não lança", () => {
    expect(() => assertEnvironmentConfirmed("prod", PROD_PROJECT_REF)).not.toThrow();
  });
});

/* ================= PASSO 2 — URL bate com o ambiente declarado ================= */

describe("assertUrlMatchesEnvironment — dev aceita URL de dev, prod aceita URL de prod", () => {
  it("URL de dev + environment dev -> não lança", () => {
    expect(() => assertUrlMatchesEnvironment(DEV_URL, "dev")).not.toThrow();
  });
  it("URL de prod + environment prod -> não lança", () => {
    expect(() => assertUrlMatchesEnvironment(PROD_URL, "prod")).not.toThrow();
  });
});

describe("assertUrlMatchesEnvironment — misturar dev/prod recusa nos dois sentidos", () => {
  it("URL de PROD + --environment dev -> EnvironmentGuardError mencionando PRODUÇÃO", () => {
    expect(() => assertUrlMatchesEnvironment(PROD_URL, "dev")).toThrow(EnvironmentGuardError);
    try {
      assertUrlMatchesEnvironment(PROD_URL, "dev");
    } catch (e) {
      expect((e as Error).message).toMatch(/PRODUÇÃO/);
    }
  });
  it("URL de DEV + --environment prod -> EnvironmentGuardError mencionando DEV", () => {
    expect(() => assertUrlMatchesEnvironment(DEV_URL, "prod")).toThrow(EnvironmentGuardError);
    try {
      assertUrlMatchesEnvironment(DEV_URL, "prod");
    } catch (e) {
      expect((e as Error).message).toMatch(/DEV/);
    }
  });
});

describe("assertUrlMatchesEnvironment — project-ref desconhecido sempre recusa", () => {
  it("ref que não é nem dev nem prod -> EnvironmentGuardError, para os dois ambientes", () => {
    for (const env of KNOWN_ENVIRONMENTS) {
      expect(() => assertUrlMatchesEnvironment("https://outroref123.supabase.co", env)).toThrow(
        EnvironmentGuardError,
      );
    }
  });
  it("URL que nem bate o formato Supabase -> EnvironmentGuardError, para os dois ambientes", () => {
    for (const env of KNOWN_ENVIRONMENTS) {
      expect(() => assertUrlMatchesEnvironment("https://minha-api-qualquer.com", env)).toThrow(
        EnvironmentGuardError,
      );
    }
  });
  it("nenhum modo genérico aceita 'qualquer ref que não seja o outro' — só os 2 refs conhecidos passam", () => {
    // prova negativa: um 3º ref plausível (mesmo formato, mesmo tamanho dos
    // refs reais) continua rejeitado.
    const plausibleButUnknown = "a".repeat(DEV_PROJECT_REF.length);
    expect(() =>
      assertUrlMatchesEnvironment(`https://${plausibleButUnknown}.supabase.co`, "dev"),
    ).toThrow(EnvironmentGuardError);
    expect(() =>
      assertUrlMatchesEnvironment(`https://${plausibleButUnknown}.supabase.co`, "prod"),
    ).toThrow(EnvironmentGuardError);
  });
});
