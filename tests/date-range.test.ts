import { describe, expect, it } from "vitest";
import {
  eachDay,
  parseCustomRange,
  parsePeriod,
  previousRange,
  rangeLengthDays,
  resolvePeriod,
} from "@/lib/date-range";

const TODAY = "2026-09-01"; // terça-feira

describe("parsePeriod", () => {
  it("aceita presets válidos e cai no padrão para inválidos", () => {
    expect(parsePeriod("last_30d")).toBe("last_30d");
    expect(parsePeriod("banana")).toBe("last_7d");
    expect(parsePeriod(null)).toBe("last_7d");
  });

  it("aceita um fallback explícito (ex.: Agency Overview default = last_30d)", () => {
    expect(parsePeriod(undefined, "last_30d")).toBe("last_30d");
    expect(parsePeriod(null, "last_30d")).toBe("last_30d");
    expect(parsePeriod("banana", "last_30d")).toBe("last_30d");
    // preset explícito na URL sempre vence o fallback da página.
    expect(parsePeriod("today", "last_30d")).toBe("today");
  });
});

describe("resolvePeriod", () => {
  it("today / yesterday", () => {
    expect(resolvePeriod("today", TODAY)).toEqual({ start: "2026-09-01", end: "2026-09-01" });
    expect(resolvePeriod("yesterday", TODAY)).toEqual({ start: "2026-08-31", end: "2026-08-31" });
  });

  it("últimos N dias terminam hoje e o incluem", () => {
    expect(resolvePeriod("last_7d", TODAY)).toEqual({ start: "2026-08-26", end: "2026-09-01" });
    expect(resolvePeriod("last_30d", TODAY)).toEqual({ start: "2026-08-03", end: "2026-09-01" });
  });

  it("este mês vai do dia 1 até hoje", () => {
    expect(resolvePeriod("this_month", TODAY)).toEqual({ start: "2026-09-01", end: "2026-09-01" });
  });

  it("mês anterior cobre o mês inteiro", () => {
    expect(resolvePeriod("last_month", TODAY)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });
});

describe("rangeLengthDays / eachDay", () => {
  it("conta os dois extremos", () => {
    expect(rangeLengthDays({ start: "2026-08-26", end: "2026-09-01" })).toBe(7);
    expect(eachDay({ start: "2026-08-30", end: "2026-09-01" })).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });
});

describe("previousRange", () => {
  it("mesma duração, terminando um dia antes do início", () => {
    const current = resolvePeriod("last_7d", TODAY); // 26/08 -> 01/09
    expect(previousRange(current)).toEqual({ start: "2026-08-19", end: "2026-08-25" });
  });
});

describe("parseCustomRange — BUG 01 V1.1 (período personalizado)", () => {
  it("range válido: retorna { start, end } exatamente como recebido", () => {
    expect(parseCustomRange("2025-05-14", "2025-06-30")).toEqual({
      start: "2025-05-14",
      end: "2025-06-30",
    });
  });

  it("range histórico de meses seguidos (o caso real do bug: > 30 dias, atravessa vários meses)", () => {
    expect(parseCustomRange("2025-05-14", "2026-09-13")).toEqual({
      start: "2025-05-14",
      end: "2026-09-13",
    });
  });

  it("dateFrom ausente -> null", () => {
    expect(parseCustomRange(null, "2025-06-30")).toBeNull();
    expect(parseCustomRange(undefined, "2025-06-30")).toBeNull();
    expect(parseCustomRange("", "2025-06-30")).toBeNull();
  });

  it("dateTo ausente -> null", () => {
    expect(parseCustomRange("2025-05-14", null)).toBeNull();
    expect(parseCustomRange("2025-05-14", undefined)).toBeNull();
    expect(parseCustomRange("2025-05-14", "")).toBeNull();
  });

  it("formato inválido -> null (não é YYYY-MM-DD)", () => {
    expect(parseCustomRange("14/05/2025", "2025-06-30")).toBeNull();
    expect(parseCustomRange("2025-5-14", "2025-06-30")).toBeNull();
    expect(parseCustomRange("2025-05-14T00:00:00Z", "2025-06-30")).toBeNull();
    expect(parseCustomRange("not-a-date", "2025-06-30")).toBeNull();
  });

  it("data de calendário inexistente -> null (não só formato — valida o calendário)", () => {
    expect(parseCustomRange("2025-02-30", "2025-06-30")).toBeNull(); // fevereiro não tem dia 30
    expect(parseCustomRange("2025-13-01", "2025-06-30")).toBeNull(); // mês 13
    expect(parseCustomRange("2025-04-31", "2025-06-30")).toBeNull(); // abril tem 30 dias
  });

  it("dateFrom > dateTo -> null", () => {
    expect(parseCustomRange("2025-06-30", "2025-05-14")).toBeNull();
  });

  it("dateFrom === dateTo -> válido (range de 1 dia)", () => {
    expect(parseCustomRange("2025-05-14", "2025-05-14")).toEqual({
      start: "2025-05-14",
      end: "2025-05-14",
    });
  });

  it("nunca lança exceção, mesmo com lixo total", () => {
    expect(() => parseCustomRange("💥", "🔥")).not.toThrow();
    expect(parseCustomRange("💥", "🔥")).toBeNull();
  });
});
