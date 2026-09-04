import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

const NOW = Date.parse("2026-09-04T12:00:00Z");

describe("formatRelativeTime", () => {
  it("null / inválido -> travessão", () => {
    expect(formatRelativeTime(null, NOW)).toBe("—");
    expect(formatRelativeTime("not-a-date", NOW)).toBe("—");
  });
  it("< 1 min -> 'agora'", () => {
    expect(formatRelativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe("agora");
  });
  it("minutos", () => {
    expect(formatRelativeTime(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe("há 12 min");
  });
  it("horas (< 48h)", () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("há 3h");
  });
  it("dias (>= 48h)", () => {
    expect(formatRelativeTime(new Date(NOW - 72 * 3_600_000).toISOString(), NOW)).toBe("há 3d");
  });
});
