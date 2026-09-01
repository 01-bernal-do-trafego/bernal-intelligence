import { describe, expect, it } from "vitest";
import { compareMetric, percentChange } from "@/lib/comparison";

describe("percentChange", () => {
  it("calcula a variação percentual", () => {
    expect(percentChange(15, 20)).toBe(-25);
    expect(percentChange(120, 100)).toBe(20);
  });

  it("retorna null quando não há base anterior", () => {
    expect(percentChange(10, 0)).toBeNull();
  });

  it("retorna null para valores não finitos", () => {
    expect(percentChange(Number.NaN, 10)).toBeNull();
    expect(percentChange(10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("compareMetric", () => {
  it("CPL que cai é positivo (lower_is_better)", () => {
    const c = compareMetric(15, 20, "lower_is_better");
    expect(c.changePct).toBe(-25);
    expect(c.direction).toBe("down");
    expect(c.sentiment).toBe("positive");
  });

  it("CPL que sobe é negativo (lower_is_better)", () => {
    const c = compareMetric(25, 20, "lower_is_better");
    expect(c.direction).toBe("up");
    expect(c.sentiment).toBe("negative");
  });

  it("Resultados que sobem são positivos (higher_is_better)", () => {
    const c = compareMetric(120, 100, "higher_is_better");
    expect(c.changePct).toBe(20);
    expect(c.sentiment).toBe("positive");
  });

  it("comportamento neutral/contextual não recebe julgamento automático", () => {
    expect(compareMetric(120, 100, "neutral").sentiment).toBe("neutral");
    expect(compareMetric(80, 100, "contextual").sentiment).toBe("neutral");
  });

  it("sem variação => flat e neutro", () => {
    const c = compareMetric(100, 100, "higher_is_better");
    expect(c.direction).toBe("flat");
    expect(c.sentiment).toBe("neutral");
    expect(c.changePct).toBe(0);
  });

  it("mantém changePct null quando não há base anterior", () => {
    const c = compareMetric(50, 0, "higher_is_better");
    expect(c.changePct).toBeNull();
    expect(c.direction).toBe("up");
    expect(c.sentiment).toBe("positive");
  });
});
