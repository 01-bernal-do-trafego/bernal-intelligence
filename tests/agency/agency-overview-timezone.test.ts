/**
 * "Hoje" da Agency Overview no fuso da AGÊNCIA (America/Sao_Paulo), não UTC.
 * Reaproveita `todayInOffset`/`utcOffsetMinutes` já usados por conta no
 * dashboard individual — aqui só com um fuso FIXO.
 */
import { describe, expect, it } from "vitest";
import { agencyToday } from "@/lib/meta/agency-overview";
import { metaPresetRange } from "@/lib/meta/date-preset";

describe("agencyToday — América/São Paulo, não UTC", () => {
  it("23:30 em São Paulo (já 02:30 UTC do dia seguinte) -> 'hoje' é o dia de SP", () => {
    // 2026-09-04T23:30:00-03:00 == 2026-09-05T02:30:00Z
    const now = new Date("2026-09-05T02:30:00Z");
    expect(agencyToday(now)).toBe("2026-09-04");
  });

  it("virada de dia: 1 min antes/depois da meia-noite de SP", () => {
    // 2026-09-03T23:59:00-03:00 == 2026-09-04T02:59:00Z
    expect(agencyToday(new Date("2026-09-04T02:59:00Z"))).toBe("2026-09-03");
    // 2026-09-04T00:01:00-03:00 == 2026-09-04T03:01:00Z
    expect(agencyToday(new Date("2026-09-04T03:01:00Z"))).toBe("2026-09-04");
  });

  it("meio da tarde em SP -> mesmo dia em UTC e SP (sem diferença aparente)", () => {
    // 2026-09-04T15:00:00-03:00 == 2026-09-04T18:00:00Z
    expect(agencyToday(new Date("2026-09-04T18:00:00Z"))).toBe("2026-09-04");
  });
});

describe("agencyToday + metaPresetRange — virada de mês pelo fuso certo", () => {
  it("31/ago 23:30 em SP (já 1/set em UTC) -> 'este mês' AINDA é agosto", () => {
    // 2026-08-31T23:30:00-03:00 == 2026-09-01T02:30:00Z
    const now = new Date("2026-09-01T02:30:00Z");
    const today = agencyToday(now);
    expect(today).toBe("2026-08-31"); // não "2026-09-01" (o que UTC diria)

    const thisMonth = metaPresetRange("this_month", today);
    expect(thisMonth).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("1º dia do mês em SP -> 'este mês' começa nele mesmo", () => {
    // 2026-09-01T00:05:00-03:00 == 2026-09-01T03:05:00Z
    const now = new Date("2026-09-01T03:05:00Z");
    const today = agencyToday(now);
    expect(today).toBe("2026-09-01");
    expect(metaPresetRange("this_month", today)).toEqual({
      start: "2026-09-01",
      end: "2026-09-01",
    });
  });

  it("'mês passado' também usa o dia de SP na virada", () => {
    const now = new Date("2026-09-01T02:30:00Z"); // ainda 31/ago em SP
    const today = agencyToday(now);
    expect(metaPresetRange("last_month", today)).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });
});
