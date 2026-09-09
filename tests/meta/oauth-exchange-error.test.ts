/**
 * `lib/meta/oauth-exchange-error.ts` — diagnóstico sanitizado do exchange_failed.
 * O contrato: o log PODE conter status/type/code/subcode/mensagem redigida;
 * NUNCA code de autorização, token, secret ou corpo cru.
 */
import { describe, expect, it } from "vitest";
import {
  buildSanitizedExchangeError,
  sanitizeMetaMessage,
  SANITIZED_MESSAGE_MAX,
} from "@/lib/meta/oauth-exchange-error";

describe("sanitizeMetaMessage", () => {
  it("não-string -> vazio", () => {
    expect(sanitizeMetaMessage(undefined)).toBe("");
    expect(sanitizeMetaMessage(null)).toBe("");
    expect(sanitizeMetaMessage(42)).toBe("");
  });

  it("colapsa espaços e trima", () => {
    expect(sanitizeMetaMessage("  foo   bar\n baz ")).toBe("foo bar baz");
  });

  it("redige sequências longas parecidas com token/segredo", () => {
    const msg = "Invalid code AQI9xZ2k3mN8pQ7rS6tU5vW4xY3zA2bC1dE0fG7hJ used";
    const out = sanitizeMetaMessage(msg);
    expect(out).toContain("[redacted]");
    expect(out).not.toMatch(/AQI9xZ2k3mN8pQ7rS6tU5vW4xY3zA2bC1dE0fG7hJ/);
  });

  it("trunca no limite", () => {
    const out = sanitizeMetaMessage("erro ".repeat(100)); // 500 chars, tokens curtos
    expect(out.length).toBe(SANITIZED_MESSAGE_MAX);
  });
});

describe("buildSanitizedExchangeError", () => {
  it("resposta não-JSON -> só status + non_json", () => {
    expect(buildSanitizedExchangeError({ httpStatus: 502, body: null })).toEqual({
      meta_http_status: 502,
      meta_error_type: null,
      meta_error_code: null,
      meta_error_subcode: null,
      meta_message: null,
      non_json: true,
    });
  });

  it("erro OAuth típico (redirect_uri mismatch) -> campos preenchidos", () => {
    const body = {
      error: {
        message: "Missing redirect_uri parameter.",
        type: "OAuthException",
        code: 191,
        error_subcode: 1,
        fbtrace_id: "ABC123trace",
      },
    };
    expect(buildSanitizedExchangeError({ httpStatus: 400, body })).toEqual({
      meta_http_status: 400,
      meta_error_type: "OAuthException",
      meta_error_code: 191,
      meta_error_subcode: 1,
      meta_message: "Missing redirect_uri parameter.",
      non_json: false,
    });
  });

  it("JSON sem objeto error -> type/code/subcode null, message null", () => {
    expect(
      buildSanitizedExchangeError({ httpStatus: 500, body: { foo: "bar" } }),
    ).toEqual({
      meta_http_status: 500,
      meta_error_type: null,
      meta_error_code: null,
      meta_error_subcode: null,
      meta_message: null,
      non_json: false,
    });
  });

  it("NUNCA carrega code/token/secret ainda que apareçam no corpo", () => {
    const body = {
      access_token: "EAABsecretTOKENvalue1234567890",
      error: {
        message:
          "This authorization code AQD_supersecretCODEvalue0987654321 has expired.",
        type: "OAuthException",
        code: 100,
      },
    };
    const out = buildSanitizedExchangeError({ httpStatus: 400, body });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/EAABsecretTOKENvalue/);
    expect(serialized).not.toMatch(/AQD_supersecretCODEvalue/);
    expect(serialized).not.toMatch(/access_token/);
    expect(out.meta_message).toContain("[redacted]");
    expect(out.meta_error_code).toBe(100);
  });
});
