import { describe, expect, it } from "vitest";
import {
  describeCallbackReason,
  describeMetaRedirectError,
  parseCallbackReason,
} from "@/lib/meta/oauth-errors";

describe("parseCallbackReason", () => {
  it("mantém motivos conhecidos e cai em unknown no resto", () => {
    expect(parseCallbackReason("denied")).toBe("denied");
    expect(parseCallbackReason("state")).toBe("state");
    expect(parseCallbackReason("exchange")).toBe("exchange");
    expect(parseCallbackReason("qualquer-coisa")).toBe("unknown");
    expect(parseCallbackReason(null)).toBe("unknown");
  });
});

describe("describeCallbackReason", () => {
  it("dá uma frase PT para cada motivo", () => {
    expect(describeCallbackReason("denied")).toMatch(/cancelada/i);
    expect(describeCallbackReason("state")).toMatch(/segurança/i);
    expect(describeCallbackReason("nocode")).toMatch(/código de autorização/i);
    expect(describeCallbackReason("exchange")).toMatch(/troca segura/i);
    expect(describeCallbackReason(undefined)).toMatch(/não foi possível/i);
  });
});

describe("describeMetaRedirectError", () => {
  it("retorna null quando não há erro da Meta", () => {
    expect(describeMetaRedirectError({})).toBeNull();
    expect(describeMetaRedirectError({ error: "" })).toBeNull();
  });

  it("reconhece cancelamento do usuário", () => {
    expect(
      describeMetaRedirectError({
        error: "access_denied",
        error_reason: "user_denied",
      }),
    ).toMatch(/cancelou/i);
  });

  it("usa a descrição da Meta quando presente", () => {
    expect(
      describeMetaRedirectError({
        error: "server_error",
        error_description: "Algo deu errado",
      }),
    ).toBe("O Facebook recusou a autorização: Algo deu errado");
  });

  it("fallback com o código do erro", () => {
    expect(describeMetaRedirectError({ error: "weird_error" })).toBe(
      "O Facebook recusou a autorização (weird_error).",
    );
  });
});
