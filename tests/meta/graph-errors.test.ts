import { describe, expect, it } from "vitest";
import {
  classifyMetaErrorBody,
  classifyMetaErrorCode,
  describeDiscoveryReason,
  parseDiscoveryReason,
} from "@/lib/meta/graph-errors";

describe("classifyMetaErrorCode", () => {
  it("190 => token_revoked (reconexão)", () => {
    expect(classifyMetaErrorCode(190)).toBe("token_revoked");
    expect(classifyMetaErrorCode(102, 463)).toBe("token_revoked");
  });
  it("10 / 200 / 299 => insufficient_permission", () => {
    expect(classifyMetaErrorCode(10)).toBe("insufficient_permission");
    expect(classifyMetaErrorCode(200)).toBe("insufficient_permission");
    expect(classifyMetaErrorCode(299)).toBe("insufficient_permission");
  });
  it("4 / 17 / 613 => rate_limited", () => {
    expect(classifyMetaErrorCode(4)).toBe("rate_limited");
    expect(classifyMetaErrorCode(613)).toBe("rate_limited");
  });
  it("1 / 2 => transient; resto => unknown", () => {
    expect(classifyMetaErrorCode(1)).toBe("transient");
    expect(classifyMetaErrorCode(2)).toBe("transient");
    expect(classifyMetaErrorCode(99999)).toBe("unknown");
    expect(classifyMetaErrorCode(null)).toBe("unknown");
  });
});

describe("classifyMetaErrorBody", () => {
  it("lê error.code / error_subcode de um corpo real da Meta", () => {
    expect(
      classifyMetaErrorBody({
        error: {
          message: "Error validating access token: Session has expired",
          type: "OAuthException",
          code: 190,
        },
      }),
    ).toBe("token_revoked");
  });
  it("corpo sem error => unknown", () => {
    expect(classifyMetaErrorBody({})).toBe("unknown");
    expect(classifyMetaErrorBody(null)).toBe("unknown");
    expect(classifyMetaErrorBody("boom")).toBe("unknown");
  });
});

describe("parse/describe DiscoveryReason", () => {
  it("mantém reasons conhecidos, resto vira unknown", () => {
    expect(parseDiscoveryReason("token_revoked")).toBe("token_revoked");
    expect(parseDiscoveryReason("account_linked_elsewhere")).toBe(
      "account_linked_elsewhere",
    );
    expect(parseDiscoveryReason("xpto")).toBe("unknown");
    expect(parseDiscoveryReason(null)).toBe("unknown");
  });

  it("cada reason tem mensagem PT util", () => {
    expect(describeDiscoveryReason("token_revoked")).toMatch(/reconecte/i);
    expect(describeDiscoveryReason("insufficient_permission")).toMatch(/permiss/i);
    expect(describeDiscoveryReason("rate_limited")).toMatch(/limitou|minutos/i);
    expect(describeDiscoveryReason("not_connected")).toMatch(/não tem a Meta/i);
    expect(describeDiscoveryReason("account_linked_elsewhere")).toMatch(
      /outro cliente/i,
    );
    expect(describeDiscoveryReason("function_unavailable")).toMatch(
      /não está dispon/i,
    );
    expect(describeDiscoveryReason("unknown")).toMatch(/não foi possível/i);
  });

  it("reasons da sincronização (META 5)", () => {
    expect(parseDiscoveryReason("sync_already_running")).toBe("sync_already_running");
    expect(parseDiscoveryReason("no_linked_account")).toBe("no_linked_account");
    expect(parseDiscoveryReason("partial")).toBe("partial");
    expect(describeDiscoveryReason("sync_already_running")).toMatch(/em andamento/i);
    expect(describeDiscoveryReason("no_linked_account")).toMatch(/vincule uma conta/i);
    expect(describeDiscoveryReason("partial")).toMatch(/parcial/i);
  });
});

describe("classificação em contexto de sincronização", () => {
  it("erro 190 no meio da sync => token_revoked (marca reconexão)", () => {
    expect(
      classifyMetaErrorBody({ error: { type: "OAuthException", code: 190 } }),
    ).toBe("token_revoked");
  });
  it("erro 10 => insufficient_permission", () => {
    expect(classifyMetaErrorBody({ error: { code: 10 } })).toBe(
      "insufficient_permission",
    );
  });
  it("rate limit (4 / 80000) => rate_limited", () => {
    expect(classifyMetaErrorBody({ error: { code: 4 } })).toBe("rate_limited");
    expect(classifyMetaErrorBody({ error: { code: 80000 } })).toBe("rate_limited");
  });
});
