/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 * Teste REAL (unit) de lib/share-token.ts — módulo puro, sem "server-only"
 * de propósito (ver comentário no arquivo).
 */
import { describe, expect, it } from "vitest";
import {
  generateShareToken,
  hashShareToken,
  isPlausibleShareToken,
} from "@/lib/share-token";

describe("generateShareToken — criptograficamente aleatório", () => {
  it("43 caracteres, alfabeto base64url (sem +, /, =)", () => {
    const token = generateShareToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toMatch(/[+/=]/);
  });

  it("1000 gerações -> todas distintas entre si (sem colisão, alta entropia)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(tokens.size).toBe(1000);
  });

  it("dois tokens gerados em sequência nunca são iguais", () => {
    expect(generateShareToken()).not.toBe(generateShareToken());
  });
});

describe("hashShareToken — SHA-256 hex, determinístico, nunca o token em claro", () => {
  it("64 caracteres hex", () => {
    const hash = hashShareToken(generateShareToken());
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("determinístico: mesmo token -> mesmo hash sempre", () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
  });

  it("tokens diferentes -> hashes diferentes", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(hashShareToken(a)).not.toBe(hashShareToken(b));
  });

  it("o hash nunca contém o token em claro como substring", () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).not.toContain(token);
  });

  it("valor conhecido (vetor de teste SHA-256 de 'abc')", () => {
    expect(hashShareToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("isPlausibleShareToken — filtro de formato barato, antes de qualquer query", () => {
  it("aceita um token real gerado por generateShareToken", () => {
    expect(isPlausibleShareToken(generateShareToken())).toBe(true);
  });

  it("rejeita tamanho errado (curto ou longo demais)", () => {
    expect(isPlausibleShareToken("a".repeat(42))).toBe(false);
    expect(isPlausibleShareToken("a".repeat(44))).toBe(false);
    expect(isPlausibleShareToken("")).toBe(false);
  });

  it("rejeita caracteres fora do alfabeto base64url (+, /, =, espaço, etc.)", () => {
    expect(isPlausibleShareToken("+".repeat(43))).toBe(false);
    expect(isPlausibleShareToken("/".repeat(43))).toBe(false);
    expect(isPlausibleShareToken(`${"a".repeat(42)}=`)).toBe(false);
    expect(isPlausibleShareToken(`${"a".repeat(42)} `)).toBe(false);
  });

  it("rejeita tentativas óbvias de injeção/path traversal", () => {
    expect(isPlausibleShareToken("../../../../etc/passwd" + "a".repeat(21))).toBe(false);
    expect(isPlausibleShareToken("' OR '1'='1" + "a".repeat(32))).toBe(false);
  });
});
