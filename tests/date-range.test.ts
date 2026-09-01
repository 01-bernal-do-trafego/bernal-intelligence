import { describe, expect, it } from "vitest";
import {
  eachDay,
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
