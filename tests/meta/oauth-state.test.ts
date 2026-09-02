import { describe, expect, it } from "vitest";
import {
  createStatePayload,
  decodeStateCookie,
  encodeStateCookie,
  META_OAUTH_STATE_TTL_MS,
  timingSafeEqual,
  validateState,
} from "@/lib/meta/oauth-state";

const NOW = 1_800_000_000_000;
const BASE = {
  clientId: "11111111-1111-4111-8111-111111111111",
  uid: "user-abc",
  nonce: "nonce-xyz-123",
  now: NOW,
};

function cookieFor(overrides: Partial<typeof BASE> = {}): string {
  return encodeStateCookie(createStatePayload({ ...BASE, ...overrides }));
}

describe("encode/decode do cookie de state", () => {
  it("faz round-trip do payload", () => {
    const payload = createStatePayload(BASE);
    expect(decodeStateCookie(encodeStateCookie(payload))).toEqual(payload);
  });

  it("rejeita lixo / campos faltando", () => {
    expect(decodeStateCookie(null)).toBeNull();
    expect(decodeStateCookie("")).toBeNull();
    expect(decodeStateCookie("não-é-base64!!")).toBeNull();
    expect(decodeStateCookie(btoa(JSON.stringify({ nonce: "x" })))).toBeNull();
  });
});

describe("validateState", () => {
  it("aceita state válido e devolve clientId/uid DO COOKIE", () => {
    const result = validateState({
      cookieRaw: cookieFor(),
      stateParam: "nonce-xyz-123",
      now: NOW + 1000,
    });
    expect(result).toEqual({
      ok: true,
      clientId: BASE.clientId,
      uid: BASE.uid,
    });
  });

  it("sem cookie => missing", () => {
    expect(
      validateState({ cookieRaw: null, stateParam: "nonce-xyz-123", now: NOW }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("cookie corrompido => malformed", () => {
    expect(
      validateState({ cookieRaw: "@@@@", stateParam: "x", now: NOW }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("expirado (iat mais velho que o TTL) => expired", () => {
    expect(
      validateState({
        cookieRaw: cookieFor(),
        stateParam: "nonce-xyz-123",
        now: NOW + META_OAUTH_STATE_TTL_MS + 1,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("state adulterado (nonce diferente) => nonce_mismatch", () => {
    expect(
      validateState({
        cookieRaw: cookieFor(),
        stateParam: "nonce-OUTRO",
        now: NOW + 1000,
      }),
    ).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("state ausente na query => nonce_mismatch", () => {
    expect(
      validateState({ cookieRaw: cookieFor(), stateParam: null, now: NOW }),
    ).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("não confia em clientId da query — só o do cookie conta", () => {
    // Mesmo que um atacante troque o nonce para casar, o clientId vem do cookie.
    const result = validateState({
      cookieRaw: cookieFor({ clientId: "22222222-2222-4222-8222-222222222222" }),
      stateParam: "nonce-xyz-123",
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      clientId: "22222222-2222-4222-8222-222222222222",
      uid: BASE.uid,
    });
  });
});

describe("timingSafeEqual", () => {
  it("compara conteúdo, não referência", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
