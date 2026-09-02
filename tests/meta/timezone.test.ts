import { describe, expect, it } from "vitest";
import { utcOffsetLabel, utcOffsetMinutes } from "@/lib/meta/timezone";

// Instante fixo (inverno no hemisfério sul, sem horário de verão em nenhum
// dos fusos testados) para deixar os offsets determinísticos.
const AT = new Date("2026-07-15T12:00:00Z");

describe("utcOffsetLabel", () => {
  it("Brasil (offset inteiro)", () => {
    expect(utcOffsetLabel("America/Sao_Paulo", AT)).toBe("UTC−03:00");
  });

  it("fusos com meia hora / 45 min — o caso que quebrava o integer", () => {
    expect(utcOffsetLabel("Asia/Kolkata", AT)).toBe("UTC+05:30");
    expect(utcOffsetLabel("Asia/Kathmandu", AT)).toBe("UTC+05:45");
    expect(utcOffsetLabel("Australia/Eucla", AT)).toBe("UTC+08:45");
  });

  it("UTC e Londres no inverno", () => {
    expect(utcOffsetLabel("UTC", AT)).toBe("UTC±00:00");
    expect(utcOffsetLabel("Atlantic/Reykjavik", AT)).toBe("UTC±00:00");
  });

  it("offset positivo inteiro", () => {
    expect(utcOffsetLabel("Europe/Berlin", AT)).toBe("UTC+02:00"); // CEST em julho
    expect(utcOffsetLabel("Asia/Tokyo", AT)).toBe("UTC+09:00");
  });

  it("fuso inválido => null (nunca aproxima)", () => {
    expect(utcOffsetLabel("Nao/Existe", AT)).toBeNull();
    expect(utcOffsetLabel("", AT)).toBeNull();
  });
});

describe("utcOffsetMinutes", () => {
  it("converte o rótulo em minutos assinados", () => {
    expect(utcOffsetMinutes("America/Sao_Paulo", AT)).toBe(-180);
    expect(utcOffsetMinutes("Asia/Kolkata", AT)).toBe(330);
    expect(utcOffsetMinutes("Asia/Kathmandu", AT)).toBe(345);
    expect(utcOffsetMinutes("UTC", AT)).toBe(0);
    expect(utcOffsetMinutes("Nao/Existe", AT)).toBeNull();
  });
});
