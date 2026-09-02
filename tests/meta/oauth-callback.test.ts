import { describe, expect, it } from "vitest";
import { decideCallback } from "@/lib/meta/oauth-callback";
import type { StateValidation } from "@/lib/meta/oauth-state";

const OK_STATE: StateValidation = {
  ok: true,
  clientId: "11111111-1111-4111-8111-111111111111",
  uid: "user-abc",
};

const AGENCY = { uid: "user-abc", isAgency: true };

function decide(over: Partial<Parameters<typeof decideCallback>[0]> = {}) {
  return decideCallback({
    query: { code: "auth-code", state: "nonce" },
    state: OK_STATE,
    session: AGENCY,
    canAccessClient: true,
    ...over,
  });
}

describe("decideCallback", () => {
  it("caminho feliz => exchange com clientId do state + code", () => {
    expect(decide()).toEqual({
      kind: "exchange",
      clientId: OK_STATE.clientId,
      code: "auth-code",
    });
  });

  it("erro da Meta (usuário cancelou) => denied, antes de tudo", () => {
    const d = decide({
      query: {
        error: "access_denied",
        error_reason: "user_denied",
        error_description: "Permissions error",
      },
    });
    expect(d.kind).toBe("denied");
  });

  it("sem sessão de agência => forbidden", () => {
    expect(decide({ session: { uid: null, isAgency: false } }).kind).toBe(
      "forbidden",
    );
    expect(
      decide({ session: { uid: "u", isAgency: false } }).kind,
    ).toBe("forbidden");
  });

  it("state inválido => invalid_state com o motivo", () => {
    expect(
      decide({ state: { ok: false, reason: "expired" } }),
    ).toEqual({ kind: "invalid_state", reason: "expired" });
    expect(
      decide({ state: { ok: false, reason: "nonce_mismatch" } }),
    ).toEqual({ kind: "invalid_state", reason: "nonce_mismatch" });
  });

  it("uid da sessão diferente do uid do state => forbidden (troca de sessão)", () => {
    expect(
      decide({ session: { uid: "outro-user", isAgency: true } }).kind,
    ).toBe("forbidden");
  });

  it("callback sem code (e sem erro da Meta) => missing_code", () => {
    expect(decide({ query: { state: "nonce" } }).kind).toBe("missing_code");
    expect(decide({ query: { code: "  ", state: "nonce" } }).kind).toBe(
      "missing_code",
    );
  });

  it("usuário sem acesso ao cliente => forbidden", () => {
    expect(decide({ canAccessClient: false }).kind).toBe("forbidden");
  });

  it("ordem: erro da Meta vence state inválido", () => {
    const d = decide({
      query: { error: "access_denied" },
      state: { ok: false, reason: "missing" },
    });
    expect(d.kind).toBe("denied");
  });
});
