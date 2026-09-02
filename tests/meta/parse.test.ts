import { describe, expect, it } from "vitest";
import {
  ensureActPrefix,
  isValidMetaId,
  metaTimeToISO,
  metaTimeToISODate,
  parseMetaInt,
  parseMetaNumber,
  stripActPrefix,
} from "@/lib/meta/parse";

describe("parseMetaNumber", () => {
  it("converte string numérica da Meta", () => {
    expect(parseMetaNumber("1234.56")).toBe(1234.56);
    expect(parseMetaNumber("0")).toBe(0);
    expect(parseMetaNumber(42)).toBe(42);
  });

  it("ausência vira null (não 0, não NaN)", () => {
    expect(parseMetaNumber(undefined)).toBeNull();
    expect(parseMetaNumber(null)).toBeNull();
    expect(parseMetaNumber("")).toBeNull();
    expect(parseMetaNumber("abc")).toBeNull();
    expect(parseMetaNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("parseMetaInt", () => {
  it("arredonda; mantém a distinção ausência/zero", () => {
    expect(parseMetaInt("1999.7")).toBe(2000);
    expect(parseMetaInt("0")).toBe(0);
    expect(parseMetaInt(undefined)).toBeNull();
  });
});

describe("datas", () => {
  it("date_start YYYY-MM-DD", () => {
    expect(metaTimeToISODate("2026-08-01")).toBe("2026-08-01");
  });
  it("created_time com fuso -> só a data", () => {
    expect(metaTimeToISODate("2026-08-01T10:00:00-0700")).toBe("2026-08-01");
  });
  it("lixo -> null", () => {
    expect(metaTimeToISODate("ontem")).toBeNull();
    expect(metaTimeToISODate(undefined)).toBeNull();
  });
  it("metaTimeToISO devolve ISO completo", () => {
    expect(metaTimeToISO("2026-08-01T10:00:00Z")).toBe("2026-08-01T10:00:00.000Z");
    expect(metaTimeToISO("x")).toBeNull();
  });
});

describe("ids de conta", () => {
  it("act_ prefix", () => {
    expect(ensureActPrefix("123")).toBe("act_123");
    expect(ensureActPrefix("act_123")).toBe("act_123");
    expect(stripActPrefix("act_123")).toBe("123");
  });
  it("valida id Meta (dígitos, opcional act_) — nunca nome", () => {
    expect(isValidMetaId("act_1234567890")).toBe(true);
    expect(isValidMetaId("1234567890")).toBe(true);
    expect(isValidMetaId("Uniforte")).toBe(false);
    expect(isValidMetaId("")).toBe(false);
    expect(isValidMetaId(123 as unknown)).toBe(false);
  });
});
