import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatCurrencyOrDash,
  formatNumber,
  formatNumberOrDash,
  formatPercent,
  formatPercentOrDash,
} from "@/lib/format";

describe("formatXOrDash — 'sem dado' ≠ 'zero real'", () => {
  it("null/undefined -> travessão, nunca 0", () => {
    expect(formatCurrencyOrDash(null)).toBe("—");
    expect(formatCurrencyOrDash(undefined)).toBe("—");
    expect(formatNumberOrDash(null)).toBe("—");
    expect(formatPercentOrDash(null)).toBe("—");
  });
  it("zero real É mostrado como zero, não travessão (mesma formatação de formatCurrency/etc.)", () => {
    expect(formatCurrencyOrDash(0)).toBe(formatCurrency(0));
    expect(formatNumberOrDash(0)).toBe(formatNumber(0));
    expect(formatPercentOrDash(0)).toBe(formatPercent(0));
    expect(formatCurrencyOrDash(0)).not.toBe("—");
  });
  it("nunca NaN/Infinity mesmo com entrada inválida", () => {
    expect(formatCurrencyOrDash(NaN)).not.toContain("NaN");
    expect(formatCurrencyOrDash(Infinity)).not.toContain("Infinity");
    expect(formatNumberOrDash(NaN)).not.toContain("NaN");
  });
});
