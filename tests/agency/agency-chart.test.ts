import { describe, expect, it } from "vitest";
import {
  topClientsChartHeight,
  truncateClientName,
} from "@/lib/meta/agency-chart";

describe("topClientsChartHeight — altura dinâmica", () => {
  it("1 cliente não estica (~170px)", () => {
    expect(topClientsChartHeight(1)).toBe(170);
    expect(topClientsChartHeight(0)).toBe(170);
  });
  it("2..6 crescem proporcionalmente", () => {
    expect(topClientsChartHeight(2)).toBe(210);
    expect(topClientsChartHeight(3)).toBe(250);
    expect(topClientsChartHeight(5)).toBe(330);
  });
  it("6..10 no teto ~400px", () => {
    expect(topClientsChartHeight(7)).toBe(400);
    expect(topClientsChartHeight(10)).toBe(400);
    expect(topClientsChartHeight(50)).toBe(400);
  });
});

describe("truncateClientName — nome longo não quebra layout", () => {
  it("nome curto passa intacto", () => {
    expect(truncateClientName("Atacado do Chinelo")).toBe("Atacado do Chinelo");
  });
  it("nome longo é truncado com reticências (nome completo vai no tooltip)", () => {
    const long = "Distribuidora Nacional de Calçados e Acessórios Premium LTDA";
    const out = truncateClientName(long);
    expect(out.length).toBeLessThanOrEqual(22);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });
  it("max customizável", () => {
    expect(truncateClientName("abcdefghij", 5)).toBe("abcd…");
  });
});
