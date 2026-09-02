import { describe, expect, it } from "vitest";
import { eachDay, type PeriodPreset } from "@/lib/date-range";
import { metaPresetRange } from "@/lib/meta/date-preset";
import {
  coverageByPreset,
  dailyHorizon,
  presetCoverage,
  rangeCoverage,
} from "@/lib/meta/daily-coverage";

/** Conjunto de datas de um intervalo inclusivo. */
function datesOf(from: string, to: string): Set<string> {
  return new Set(eachDay({ start: from, end: to }));
}

const TODAY = "2026-09-15";

describe("dailyHorizon — cobre TODOS os presets sem buraco", () => {
  it("meio do mês: since = 1º do mês anterior (o preset 'mês anterior' precisa dele todo)", () => {
    // hoje-30 = 2026-08-16, mas last_month = 01/08..31/08 -> since = 2026-08-01
    expect(dailyHorizon(TODAY)).toEqual({ start: "2026-08-01", end: TODAY });
  });

  it("dia 1 de março: hoje-30 (30/jan) fica antes do 1º do mês anterior (1/fev)", () => {
    expect(dailyHorizon("2026-03-01")).toEqual({ start: "2026-01-30", end: "2026-03-01" });
  });

  it("dia 1/2 do mês: since = 1º do mês anterior", () => {
    expect(dailyHorizon("2026-09-01")).toEqual({ start: "2026-08-01", end: "2026-09-01" });
    expect(dailyHorizon("2026-09-02")).toEqual({ start: "2026-08-01", end: "2026-09-02" });
  });

  it("virada de ano: dez -> jan", () => {
    expect(dailyHorizon("2026-01-02")).toEqual({ start: "2025-12-01", end: "2026-01-02" });
  });

  it("(cenário 10) o horizonte contém o intervalo de cada preset", () => {
    for (const today of ["2026-09-15", "2026-09-01", "2026-09-02", "2026-01-02", "2026-03-31"]) {
      const h = dailyHorizon(today);
      for (const preset of [
        "today",
        "yesterday",
        "last_7d",
        "last_14d",
        "last_30d",
        "this_month",
        "last_month",
      ] as PeriodPreset[]) {
        const r = metaPresetRange(preset, today);
        expect(r.start >= h.start).toBe(true);
        expect(r.end <= h.end).toBe(true);
      }
    }
  });
});

describe("presetCoverage — histórico diário sincronizado com o horizonte inteiro", () => {
  const present = datesOf(dailyHorizon(TODAY).start, TODAY); // tudo sincronizado

  const cases: Array<[string, PeriodPreset]> = [
    ["1. hoje", "today"],
    ["2. ontem", "yesterday"],
    ["3. last_7d", "last_7d"],
    ["4. last_14d", "last_14d"],
    ["5. last_30d", "last_30d"],
    ["6. este mês", "this_month"],
    ["7. mês anterior", "last_month"],
  ];

  for (const [label, preset] of cases) {
    it(`${label} => complete quando o horizonte está sincronizado`, () => {
      const cov = presetCoverage({ preset, today: TODAY, presentDates: present });
      expect(cov.status).toBe("complete");
      expect(cov.missingDates).toEqual([]);
    });
  }

  it("last_7d / last_30d / este mês incluem hoje-como-parcial no requiredDates", () => {
    expect(presetCoverage({ preset: "this_month", today: TODAY, presentDates: present }).partialToday).toBe(true);
    expect(presetCoverage({ preset: "last_7d", today: TODAY, presentDates: present }).partialToday).toBe(false);
  });
});

describe("(cenário 8) mês anterior no dia 1/2 do novo mês", () => {
  it("mês anterior = 01/08–31/08; histórico começou em 03/08 => incompleto (faltam 01 e 02)", () => {
    const today = "2026-09-02";
    const present = datesOf("2026-08-03", today); // sincronizado só a partir de 03/08
    const cov = presetCoverage({ preset: "last_month", today, presentDates: present });
    expect(cov.status).toBe("partial");
    expect(cov.missingDates).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("depois de sincronizar o horizonte (01/08 em diante) => complete", () => {
    const today = "2026-09-02";
    const present = datesOf(dailyHorizon(today).start, today);
    expect(
      presetCoverage({ preset: "last_month", today, presentDates: present }).status,
    ).toBe("complete");
  });
});

describe("(cenário 9) virada de ano dezembro -> janeiro", () => {
  it("em 02/01/2026, mês anterior = dez/2025 completo, coberto pelo horizonte", () => {
    const today = "2026-01-02";
    const present = datesOf(dailyHorizon(today).start, today);
    const cov = presetCoverage({ preset: "last_month", today, presentDates: present });
    expect(metaPresetRange("last_month", today)).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(cov.status).toBe("complete");
  });
});

describe("(cenário 11) today como dado PARCIAL é permitido", () => {
  it("last_7d completo mesmo sem a linha de HOJE (hoje nunca conta como faltando)", () => {
    // last_7d em 15/09 = 08..14 (não inclui hoje) -> presença de 08..14 basta
    const present = datesOf("2026-09-08", "2026-09-14");
    const cov = presetCoverage({ preset: "last_7d", today: TODAY, presentDates: present });
    expect(cov.status).toBe("complete");
  });

  it("this_month completo com 01..14 presentes e HOJE (15) ausente", () => {
    const present = datesOf("2026-09-01", "2026-09-14");
    const cov = presetCoverage({ preset: "this_month", today: TODAY, presentDates: present });
    expect(cov.status).toBe("complete");
    expect(cov.partialToday).toBe(true);
    expect(cov.missingDates).toEqual([]);
  });

  it("preset 'today' sem a linha de hoje => empty (nada sincronizado ainda)", () => {
    const cov = presetCoverage({ preset: "today", today: TODAY, presentDates: new Set() });
    expect(cov.status).toBe("empty");
    expect(cov.partialToday).toBe(true);
  });
});

describe("(cenário 12) ausência de data necessária => incompleto", () => {
  it("falta um dia no meio => partial + missingDates", () => {
    const present = datesOf("2026-09-08", "2026-09-14");
    present.delete("2026-09-11");
    const cov = presetCoverage({ preset: "last_7d", today: TODAY, presentDates: present });
    expect(cov.status).toBe("partial");
    expect(cov.missingDates).toEqual(["2026-09-11"]);
  });

  it("nenhuma data do intervalo sincronizada => empty", () => {
    const cov = presetCoverage({ preset: "last_7d", today: TODAY, presentDates: new Set() });
    expect(cov.status).toBe("empty");
    expect(cov.missingDates.length).toBe(7);
  });
});

describe("rangeCoverage + coverageByPreset", () => {
  it("rangeCoverage aceita um intervalo arbitrário", () => {
    const present = datesOf("2026-09-01", "2026-09-30");
    const cov = rangeCoverage({
      range: { start: "2026-09-05", end: "2026-09-10" },
      today: TODAY,
      presentDates: present,
    });
    expect(cov.status).toBe("complete");
  });

  it("coverageByPreset devolve os 7 presets", () => {
    const present = datesOf("2026-08-03", "2026-09-14");
    const map = coverageByPreset({
      presets: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"],
      today: TODAY,
      presentDates: present,
    });
    expect(Object.keys(map).sort()).toEqual(
      ["last_14d", "last_30d", "last_7d", "last_month", "this_month", "today", "yesterday"].sort(),
    );
    // last_30d em 15/09 = 16/08..14/09 -> tudo presente
    expect(map.last_30d.status).toBe("complete");
    // last_month = 01/08..31/08 -> faltam 01 e 02
    expect(map.last_month.status).toBe("partial");
  });
});
