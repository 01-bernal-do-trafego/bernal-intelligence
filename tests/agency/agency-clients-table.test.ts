/**
 * Filtro/ordenação da tabela operacional (lib/meta/agency-clients-table.ts).
 * Lógica pura fora do componente React — testável sem renderizar.
 */
import { describe, expect, it } from "vitest";
import {
  clientRowFlags,
  filterClientRows,
  sortClientRows,
  type SortableClientRow,
} from "@/lib/meta/agency-clients-table";

const row = (o: Partial<SortableClientRow>): SortableClientRow => ({
  performanceStatus: "fresh",
  lastSyncStatus: "success",
  metaState: "connected",
  lastSyncAt: "2026-09-04T10:00:00Z",
  aggregate: { spend: 100, results: 10, costPerResult: 10 },
  ...o,
});

describe("clientRowFlags", () => {
  it("fresh/stale refletem performanceStatus", () => {
    expect(clientRowFlags(row({ performanceStatus: "fresh" })).fresh).toBe(true);
    expect(clientRowFlags(row({ performanceStatus: "stale" })).stale).toBe(true);
  });
  it("noMeta só quando nunca conectou", () => {
    expect(clientRowFlags(row({ metaState: "not_connected" })).noMeta).toBe(true);
    expect(clientRowFlags(row({ metaState: "expired" })).noMeta).toBe(false);
  });
  it("problem: conexão quebrada (expirada/revogada/reconexão), mas NÃO not_connected", () => {
    expect(clientRowFlags(row({ metaState: "expired" })).problem).toBe(true);
    expect(clientRowFlags(row({ metaState: "revoked" })).problem).toBe(true);
    expect(clientRowFlags(row({ metaState: "reconnect" })).problem).toBe(true);
    expect(clientRowFlags(row({ metaState: "not_connected" })).problem).toBe(false);
  });
  it("problem: última sync failed/partial", () => {
    expect(clientRowFlags(row({ lastSyncStatus: "failed" })).problem).toBe(true);
    expect(clientRowFlags(row({ lastSyncStatus: "partial" })).problem).toBe(true);
    expect(clientRowFlags(row({ lastSyncStatus: "success" })).problem).toBe(false);
  });
  it("problem: Meta conectada mas nunca sincronizou (never + não noMeta)", () => {
    expect(
      clientRowFlags(row({ performanceStatus: "never", metaState: "connected" })).problem,
    ).toBe(true);
    // never + not_connected é 'noMeta', não 'problem'
    expect(
      clientRowFlags(row({ performanceStatus: "never", metaState: "not_connected" })).problem,
    ).toBe(false);
  });
});

describe("filterClientRows", () => {
  const rows = [
    row({ performanceStatus: "fresh", metaState: "connected", lastSyncStatus: "success" }),
    row({ performanceStatus: "stale", metaState: "connected", lastSyncStatus: "success" }),
    row({ performanceStatus: "never", metaState: "not_connected", lastSyncStatus: "never" }),
    row({ performanceStatus: "fresh", metaState: "expired", lastSyncStatus: "failed" }),
  ];
  it("'all' devolve tudo", () => {
    expect(filterClientRows(rows, "all")).toHaveLength(4);
  });
  it("'fresh'/'stale'/'no_meta'/'problem' filtram corretamente", () => {
    expect(filterClientRows(rows, "fresh")).toHaveLength(2);
    expect(filterClientRows(rows, "stale")).toHaveLength(1);
    expect(filterClientRows(rows, "no_meta")).toHaveLength(1);
    expect(filterClientRows(rows, "problem")).toHaveLength(1);
  });
});

describe("sortClientRows — ordena; null sempre por último", () => {
  const rows = [
    row({ aggregate: { spend: 100, results: 5, costPerResult: 20 } }),
    row({ aggregate: { spend: null, results: null, costPerResult: null } }),
    row({ aggregate: { spend: 500, results: 50, costPerResult: 10 } }),
  ];

  it("desc por investimento — maior primeiro, null por último", () => {
    const sorted = sortClientRows(rows, "spend", "desc");
    expect(sorted.map((r) => r.aggregate.spend)).toEqual([500, 100, null]);
  });
  it("asc por investimento — null AINDA por último (não vira 'menor que tudo')", () => {
    const sorted = sortClientRows(rows, "spend", "asc");
    expect(sorted.map((r) => r.aggregate.spend)).toEqual([100, 500, null]);
  });
  it("ordena por resultados e por custo/resultado", () => {
    expect(sortClientRows(rows, "results", "desc").map((r) => r.aggregate.results)).toEqual([
      50, 5, null,
    ]);
    expect(
      sortClientRows(rows, "cost_per_result", "asc").map((r) => r.aggregate.costPerResult),
    ).toEqual([10, 20, null]);
  });
  it("ordena por última sincronização (timestamp)", () => {
    const withDates = [
      row({ lastSyncAt: "2026-09-04T08:00:00Z" }),
      row({ lastSyncAt: "2026-09-04T10:00:00Z" }),
      row({ lastSyncAt: null }),
    ];
    const sorted = sortClientRows(withDates, "last_sync", "desc");
    expect(sorted.map((r) => r.lastSyncAt)).toEqual([
      "2026-09-04T10:00:00Z",
      "2026-09-04T08:00:00Z",
      null,
    ]);
  });
  it("não muta o array original", () => {
    const original = [...rows];
    sortClientRows(rows, "spend", "asc");
    expect(rows).toEqual(original);
  });
});
