/**
 * Decisões puras da sincronização (META 5): status final, acumulação de
 * páginas, estatísticas. Módulo PURO — a orquestração real (fetch/upsert)
 * vive na Edge Function `meta-sync`.
 */

export type SyncLevel = "account" | "campaign" | "adset" | "ad";
export type SyncStage =
  | "campaigns"
  | "adsets"
  | "ads"
  | "insights_daily_account"
  | "insights_daily_campaign"
  | "insights_daily_adset"
  | "insights_daily_ad"
  | "insights_periodic_account"
  | "insights_periodic_campaign"
  | "insights_periodic_adset"
  | "insights_periodic_ad";

export type StageOutcome = "done" | "skipped" | "error";

export interface StageResult {
  stage: SyncStage;
  outcome: StageOutcome;
  /** linhas efetivamente gravadas (para `stats`). */
  rows?: number;
  pages?: number;
}

export type SyncRunStatus = "success" | "partial" | "error";

/**
 * Status final da rodada a partir dos resultados de cada etapa.
 *  - qualquer coisa gravada + nada com erro/pulado  -> success
 *  - alguma etapa com erro/pulada mas outras gravadas -> partial
 *  - nada gravado                                     -> error
 *  - `fatal` (token revogado, sem conexão, etc.)      -> error, sempre
 */
export function resolveSyncStatus(
  stages: readonly StageResult[],
  fatal = false,
): SyncRunStatus {
  if (fatal) return "error";
  const done = stages.filter((s) => s.outcome === "done");
  const bad = stages.filter((s) => s.outcome !== "done");
  if (done.length === 0) return "error";
  return bad.length === 0 ? "success" : "partial";
}

export interface SyncStats {
  status: SyncRunStatus;
  campaigns: number;
  adsets: number;
  ads: number;
  insightsDaily: number;
  insightsPeriodic: number;
  stagesDone: SyncStage[];
  stagesSkipped: SyncStage[];
  stagesErrored: SyncStage[];
  pages: number;
}

export function buildSyncStats(
  stages: readonly StageResult[],
  fatal = false,
): SyncStats {
  const sum = (pred: (s: StageResult) => boolean) =>
    stages.filter(pred).reduce((n, s) => n + (s.rows ?? 0), 0);
  const is = (p: string) => (s: StageResult) => s.stage.startsWith(p);

  return {
    status: resolveSyncStatus(stages, fatal),
    campaigns: sum((s) => s.stage === "campaigns"),
    adsets: sum((s) => s.stage === "adsets"),
    ads: sum((s) => s.stage === "ads"),
    insightsDaily: sum(is("insights_daily_")),
    insightsPeriodic: sum(is("insights_periodic_")),
    stagesDone: stages.filter((s) => s.outcome === "done").map((s) => s.stage),
    stagesSkipped: stages
      .filter((s) => s.outcome === "skipped")
      .map((s) => s.stage),
    stagesErrored: stages
      .filter((s) => s.outcome === "error")
      .map((s) => s.stage),
    pages: stages.reduce((n, s) => n + (s.pages ?? 0), 0),
  };
}

/**
 * Acumulador de paginação por cursor. Recebe uma página `{ data, nextAfter }`
 * e diz se deve continuar. Teto de `maxPages` para não rodar sem fim.
 */
export interface PageAccumulator<T> {
  items: T[];
  pages: number;
  done: boolean;
  overflow: boolean;
}

export function newPageAccumulator<T>(): PageAccumulator<T> {
  return { items: [], pages: 0, done: false, overflow: false };
}

export function accumulatePage<T>(
  acc: PageAccumulator<T>,
  page: { data: T[]; nextAfter: string | null },
  maxPages = 200,
): { acc: PageAccumulator<T>; nextAfter: string | null } {
  const items = acc.items.concat(page.data);
  const pages = acc.pages + 1;
  if (!page.nextAfter) {
    return { acc: { items, pages, done: true, overflow: false }, nextAfter: null };
  }
  if (pages >= maxPages) {
    return {
      acc: { items, pages, done: true, overflow: true },
      nextAfter: null,
    };
  }
  return {
    acc: { items, pages, done: false, overflow: false },
    nextAfter: page.nextAfter,
  };
}
