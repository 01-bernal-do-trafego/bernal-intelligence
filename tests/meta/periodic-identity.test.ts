import { describe, expect, it } from "vitest";
import {
  latestForPreset,
  periodicIntervalKey,
  sameInterval,
  upsertPeriodicRows,
  type PeriodicRowLike,
} from "@/lib/meta/periodic-identity";

const row = (over: Partial<PeriodicRowLike> = {}): PeriodicRowLike => ({
  level: "account",
  entityId: "act_1",
  dateFrom: "2026-08-03",
  dateTo: "2026-09-01",
  attributionWindow: "7d_click_1d_view",
  periodKey: "last_30d",
  reach: 10000,
  frequency: 1.5,
  ...over,
});

describe("periodicIntervalKey", () => {
  it("a identidade é o intervalo; period_key NÃO entra", () => {
    const a = periodicIntervalKey(row({ periodKey: "last_30d" }));
    const b = periodicIntervalKey(row({ periodKey: "custom" }));
    expect(a).toBe(b);
    expect(a).toBe("account|act_1|2026-08-03|2026-09-01|7d_click_1d_view");
  });

  it("intervalos ou janelas de atribuição diferentes => chaves diferentes", () => {
    expect(sameInterval(row(), row({ dateTo: "2026-09-02" }))).toBe(false);
    expect(sameInterval(row(), row({ attributionWindow: "7d_click" }))).toBe(false);
    expect(sameInterval(row(), row({ entityId: "act_2" }))).toBe(false);
  });
});

describe("upsertPeriodicRows — idempotência por intervalo", () => {
  it("mesmo intervalo sincronizado 2x => ATUALIZA, não duplica", () => {
    const first = [row({ reach: 10000, frequency: 1.5, spend: 500 })];
    const second = [row({ reach: 10250, frequency: 1.52, spend: 517 })];
    const out = upsertPeriodicRows(first, second);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reach: 10250, frequency: 1.52, spend: 517 });
  });

  it("last_30d de datas diferentes => registros DISTINTOS que convivem", () => {
    const sync02 = [row({ dateFrom: "2026-08-03", dateTo: "2026-09-01", reach: 10000 })];
    const sync03 = [row({ dateFrom: "2026-08-04", dateTo: "2026-09-02", reach: 10800 })];
    const out = upsertPeriodicRows(sync02, sync03);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.dateTo)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("período anterior permanece disponível após nova sincronização", () => {
    const prev = row({
      periodKey: "last_30d_prev",
      dateFrom: "2026-07-04",
      dateTo: "2026-08-02",
      reach: 9000,
    });
    const currentV1 = row({ dateFrom: "2026-08-03", dateTo: "2026-09-01", reach: 10000 });
    const currentV2 = row({ dateFrom: "2026-08-03", dateTo: "2026-09-01", reach: 10500 });

    const afterFirst = upsertPeriodicRows([prev], [currentV1]);
    const afterSecond = upsertPeriodicRows(afterFirst, [currentV2]);

    expect(afterSecond).toHaveLength(2);
    // o "anterior" continua lá, intacto
    expect(afterSecond.find((r) => r.periodKey === "last_30d_prev")).toMatchObject({
      reach: 9000,
      dateTo: "2026-08-02",
    });
    // o "corrente" foi atualizado, não duplicado
    expect(afterSecond.find((r) => r.dateTo === "2026-09-01")).toMatchObject({
      reach: 10500,
    });
  });

  it("períodos personalizados diferentes coexistem", () => {
    const custom = [
      row({ periodKey: "custom", dateFrom: "2026-01-01", dateTo: "2026-01-31", reach: 1000 }),
      row({ periodKey: "custom", dateFrom: "2026-02-01", dateTo: "2026-02-28", reach: 2000 }),
    ];
    const out = upsertPeriodicRows([], custom);
    expect(out).toHaveLength(2);

    // re-sync de só um dos custom não afeta o outro
    const out2 = upsertPeriodicRows(out, [
      row({ periodKey: "custom", dateFrom: "2026-02-01", dateTo: "2026-02-28", reach: 2100 }),
    ]);
    expect(out2).toHaveLength(2);
    expect(out2.find((r) => r.dateFrom === "2026-01-01")).toMatchObject({ reach: 1000 });
    expect(out2.find((r) => r.dateFrom === "2026-02-01")).toMatchObject({ reach: 2100 });
  });

  it("reach/frequency ficam associados ao intervalo correto", () => {
    const jul = row({ dateFrom: "2026-07-01", dateTo: "2026-07-31", reach: 7000, frequency: 1.2 });
    const ago = row({ dateFrom: "2026-08-01", dateTo: "2026-08-31", reach: 8000, frequency: 1.4 });
    const set = row({ dateFrom: "2026-09-01", dateTo: "2026-09-30", reach: 9000, frequency: 1.6 });

    const store = upsertPeriodicRows([jul, ago], [set, { ...ago, reach: 8250 }]);

    const byRange = new Map(store.map((r) => [`${r.dateFrom}..${r.dateTo}`, r]));
    expect(byRange.get("2026-07-01..2026-07-31")).toMatchObject({ reach: 7000, frequency: 1.2 });
    expect(byRange.get("2026-08-01..2026-08-31")).toMatchObject({ reach: 8250, frequency: 1.4 });
    expect(byRange.get("2026-09-01..2026-09-30")).toMatchObject({ reach: 9000, frequency: 1.6 });
  });
});

describe("latestForPreset", () => {
  it("pega o intervalo com date_to mais recente do preset", () => {
    const rows = [
      row({ dateFrom: "2026-08-03", dateTo: "2026-09-01" }),
      row({ dateFrom: "2026-08-04", dateTo: "2026-09-02" }),
      row({ dateFrom: "2026-08-02", dateTo: "2026-08-31" }),
      row({ periodKey: "last_7d", dateFrom: "2026-08-27", dateTo: "2026-09-02" }),
    ];
    const latest = latestForPreset(rows, {
      level: "account",
      entityId: "act_1",
      periodKey: "last_30d",
    });
    expect(latest?.dateTo).toBe("2026-09-02");
    expect(latest?.dateFrom).toBe("2026-08-04");
  });

  it("sem linhas do preset => null", () => {
    expect(
      latestForPreset([row({ periodKey: "last_7d" })], {
        level: "account",
        entityId: "act_1",
        periodKey: "last_30d",
      }),
    ).toBeNull();
  });
});
