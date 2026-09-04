/**
 * Filtro/ordenação da tabela operacional de clientes da Visão Geral. Módulo
 * PURO — fica fora do componente React de propósito (testável sem renderizar,
 * e reaproveitável se a tabela precisar de outra casca de UI no futuro).
 */
import { metaNeedsAction, type MetaUiState } from "@/lib/meta/connection-state";
import type { PerformanceStatus, LastSyncStatus } from "@/lib/meta/sync-health";

export interface SortableClientRow {
  performanceStatus: PerformanceStatus;
  lastSyncStatus: LastSyncStatus;
  metaState: MetaUiState;
  lastSyncAt: string | null;
  aggregate: {
    spend: number | null;
    results: number | null;
    costPerResult: number | null;
  };
}

export type ClientSortKey = "spend" | "results" | "cost_per_result" | "last_sync";
export type SortDir = "asc" | "desc";
export type ClientFilterKey = "all" | "fresh" | "stale" | "no_meta" | "problem";

export interface ClientRowFlags {
  fresh: boolean;
  stale: boolean;
  /** nunca teve Meta conectada. */
  noMeta: boolean;
  /**
   * precisa de atenção: conexão quebrada (expirada/revogada/reconexão), OU
   * última sync com falha/parcial, OU Meta conectada mas nunca sincronizou.
   * NÃO inclui "nunca conectou" (isso é `noMeta`, um estado próprio).
   */
  problem: boolean;
}

export function clientRowFlags(row: SortableClientRow): ClientRowFlags {
  const noMeta = row.metaState === "not_connected";
  const brokenConnection = !noMeta && metaNeedsAction(row.metaState);
  const syncProblem = row.lastSyncStatus === "failed" || row.lastSyncStatus === "partial";
  const neverButConnected = row.performanceStatus === "never" && !noMeta;
  return {
    fresh: row.performanceStatus === "fresh",
    stale: row.performanceStatus === "stale",
    noMeta,
    problem: brokenConnection || syncProblem || neverButConnected,
  };
}

export function filterClientRows<T extends SortableClientRow>(
  rows: readonly T[],
  filter: ClientFilterKey,
): T[] {
  if (filter === "all") return [...rows];
  return rows.filter((r) => {
    const flags = clientRowFlags(r);
    if (filter === "fresh") return flags.fresh;
    if (filter === "stale") return flags.stale;
    if (filter === "no_meta") return flags.noMeta;
    return flags.problem;
  });
}

function sortValue(row: SortableClientRow, key: ClientSortKey): number | null {
  switch (key) {
    case "spend":
      return row.aggregate.spend;
    case "results":
      return row.aggregate.results;
    case "cost_per_result":
      return row.aggregate.costPerResult;
    case "last_sync":
      return row.lastSyncAt ? Date.parse(row.lastSyncAt) : null;
  }
}

/** `null` sempre por último, independente da direção — nunca vira "menor que zero". */
export function sortClientRows<T extends SortableClientRow>(
  rows: readonly T[],
  key: ClientSortKey,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return dir === "asc" ? va - vb : vb - va;
  });
}
