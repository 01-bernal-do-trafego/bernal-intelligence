/**
 * DATA V2.2.3 — Real Backfill Executor. Orquestração de UM segmento. Módulo PURO.
 *
 * Evolui a fundação da V2.2.2 (que só tinha um `fetchInsights` de tiro único,
 * sem paginação visível) para o fluxo REAL de um segmento:
 *
 *   is_linked -> rate check -> [por página: heartbeat -> fetch -> heartbeat ->
 *   upsert] -> complete/fail (com fencing)
 *
 * TODA operação com efeito colateral (checar conta linkada, rate budget,
 * heartbeat, buscar 1 página da Meta JÁ NORMALIZADA, upsert, marcar
 * conexão para reautorização, completar/falhar com fencing) é INJETADA via
 * `BackfillExecutorDeps` — nenhuma implementação real, nenhuma chamada de
 * rede, nenhum SQL aqui. O adapter real (Deno, `supabase/functions/
 * meta-backfill-executor/index.ts`) implementa as portas reutilizando
 * `_shared/graph.ts`/`_shared/insights.ts`/`_shared/crypto.ts` — o MESMO
 * caminho do Current Sync (zero normalizador/mapeamento de actions/cliente
 * HTTP duplicado). Este módulo e o adapter Deno são um PAR ESPELHADO — igual
 * ao par `_shared/insights.ts` / `lib/meta/normalizer.ts` já existente no
 * projeto (fronteira Deno não importa de `lib/`, então o CONTROLE de fluxo
 * — não a normalização de dado — é mantido idêntico "à mão" nos dois lados;
 * mantenha-os em sync se um mudar).
 *
 * FENCING: `heartbeat`/`completeSegment`/`failSegment` podem devolver
 * `false` (posse perdida) a qualquer momento — o loop para IMEDIATAMENTE e
 * devolve `{kind:"refused", reason:"ownership_lost", ...}`. NUNCA escreve
 * dados depois de perder a posse; NUNCA tenta complete/fail de novo com o
 * mesmo token como se ainda fosse dono.
 *
 * PAGINAÇÃO: limite defensivo (`maxPages`), detecção de cursor repetido
 * (aborta com segurança — nunca laço infinito), página vazia é válida
 * (0 linhas, `nextCursor` pode ou não existir).
 *
 * IDEMPOTÊNCIA: cada página é upsertada assim que chega (não acumula tudo em
 * memória para o fim) — se uma página posterior falhar, as páginas já
 * upsertadas PERMANECEM (não há rollback) e o segmento é marcado `failed`
 * (retryable). Reexecutar o segmento inteiro é seguro: `upsertRows` usa a
 * mesma natural key de `meta_insights_daily` (mesma garantia do V1) — dados
 * já escritos são apenas sobrescritos pelo mesmo valor, nunca duplicados.
 */
import type { BackfillLevel } from "./types";
import type { BackfillInsightRow } from "./insight-row";
import { dedupeRows } from "./insight-row";
import type { BackfillErrorKind } from "./error-classification";
import { computeNextRetryAt } from "./error-classification";

/** Default igual ao `maxPages` de `listEdge` em `_shared/graph.ts` — mesmo teto defensivo. */
export const DEFAULT_MAX_PAGES = 200;

export interface BackfillSegmentTask {
  id: string;
  jobId: string;
  clientId: string;
  /** uuid interno (meta_ad_accounts.id) — usado para checar is_linked/rate budget. */
  adAccountRef: string;
  /** id Meta (ex.: "act_123") — usado para a chamada de fetch. */
  adAccountId: string;
  level: BackfillLevel;
  dateFrom: string;
  dateTo: string;
  /** Token de posse desta reivindicação (claim_next_backfill_segment) — obrigatório para heartbeat/finalizar. */
  leaseToken: string;
}

export interface FetchPageArgs {
  adAccountId: string;
  level: BackfillLevel;
  dateFrom: string;
  dateTo: string;
  /** cursor da página a buscar; `null` = primeira página. */
  cursor: string | null;
}

export interface FetchPageResult {
  /** linhas JÁ NORMALIZADAS (o adapter real chama toDailyRows internamente — nenhum normalizador aqui). */
  rows: readonly BackfillInsightRow[];
  /** cursor da PRÓXIMA página; `null` = não há mais páginas. */
  nextCursor: string | null;
}

export interface UpsertResult {
  rowsWritten: number;
}

export interface CompleteSegmentArgs {
  segmentId: string;
  leaseToken: string;
  rowsWritten: number;
  pagesFetched: number;
  outcome: "done" | "skipped_no_data";
}

export interface FailSegmentArgs {
  segmentId: string;
  leaseToken: string;
  errorCode: string;
  nextRetryAt: string | null;
}

/**
 * Portas injetadas — cada uma corresponde a uma responsabilidade do executor
 * real. Nenhuma tem implementação aqui.
 */
export interface BackfillExecutorDeps {
  /** reflete `meta_ad_accounts.is_linked` — recusa antes de gastar rate budget/chamar a Meta. */
  isAccountLinked: (adAccountRef: string) => Promise<boolean>;
  /** `lib/backfill/rate-limit.ts#canRunBackfill` por trás — checado antes de CADA página (pressão pode mudar entre páginas). */
  canRunBackfill: (adAccountRef: string) => Promise<boolean>;
  /**
   * RPC `extend_backfill_segment_lease` — heartbeat E check de ownership (a
   * MESMA chamada serve para os dois: ela só sucede se ainda formos o dono).
   * Chamado ANTES de cada request e ANTES de cada write. `false` = posse
   * perdida — o worker deve parar IMEDIATAMENTE.
   */
  heartbeat: (segmentId: string, leaseToken: string) => Promise<boolean>;
  /** NÃO implementado nesta camada — o adapter real busca 1 página da Meta e já normaliza (toDailyRows). */
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult>;
  /** Upsert em `meta_insights_daily` — mesmo destino/mesma natural key do Current Sync. */
  upsertRows: (rows: readonly BackfillInsightRow[]) => Promise<UpsertResult>;
  /** RPC `complete_backfill_segment` (fencing) — `false` = posse perdida. */
  completeSegment: (args: CompleteSegmentArgs) => Promise<boolean>;
  /** RPC `fail_backfill_segment` (fencing) — `false` = posse perdida. */
  failSegment: (args: FailSegmentArgs) => Promise<boolean>;
  /** Só chamado quando o erro classificado é `token_revoked` — MESMA regra de sync-core.ts. Opcional (testes podem omitir). */
  markReauthRequired?: () => Promise<void>;
}

export type ExecuteSegmentOutcome =
  | { kind: "completed"; rowsWritten: number; pagesFetched: number }
  | { kind: "skipped_no_data"; pagesFetched: number }
  | {
      kind: "failed";
      errorClass: BackfillErrorKind;
      reason: string;
      pagesFetched: number;
      rowsWritten: number;
    }
  | {
      kind: "refused";
      reason:
        | "not_linked"
        | "rate_limited"
        | "ownership_lost"
        | "pagination_loop_detected"
        | "pagination_overflow";
      pagesFetched: number;
      rowsWritten: number;
    };

/** Extrai `.kind` de um erro rejeitado por `fetchPage`, se reconhecível (duck-typing — sem classe de erro compartilhada entre Node e Deno). */
function errorKindFrom(err: unknown): BackfillErrorKind {
  const kind = (err as { kind?: unknown } | null | undefined)?.kind;
  if (
    kind === "token_revoked" ||
    kind === "insufficient_permission" ||
    kind === "rate_limited" ||
    kind === "transient" ||
    kind === "unknown"
  ) {
    return kind;
  }
  return "unknown";
}
function errorCodeFrom(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200) || "unknown_error";
  return "unknown_error";
}

async function failWithFencing(
  deps: BackfillExecutorDeps,
  task: BackfillSegmentTask,
  errorCode: string,
  kind: BackfillErrorKind,
  pagesFetched: number,
  rowsWritten: number,
): Promise<ExecuteSegmentOutcome> {
  const ok = await deps.failSegment({
    segmentId: task.id,
    leaseToken: task.leaseToken,
    errorCode,
    nextRetryAt: computeNextRetryAt(kind),
  });
  return ok
    ? { kind: "failed", errorClass: kind, reason: errorCode, pagesFetched, rowsWritten }
    : { kind: "refused", reason: "ownership_lost", pagesFetched, rowsWritten };
}

/**
 * Orquestra UM segmento do início ao fim. Ver cabeçalho do arquivo para o
 * fluxo completo. `maxPages` é defensivo (mesmo default de `listEdge`).
 */
export async function executeBackfillSegment(
  task: BackfillSegmentTask,
  deps: BackfillExecutorDeps,
  opts: { maxPages?: number } = {},
): Promise<ExecuteSegmentOutcome> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

  if (!(await deps.isAccountLinked(task.adAccountRef))) {
    return { kind: "refused", reason: "not_linked", pagesFetched: 0, rowsWritten: 0 };
  }

  let cursor: string | null = null;
  let pagesFetched = 0;
  let rowsWritten = 0;
  const seenCursors = new Set<string>();

  for (;;) {
    // rate check ANTES de cada página — pressão de rate limit pode mudar entre páginas.
    if (!(await deps.canRunBackfill(task.adAccountRef))) {
      return { kind: "refused", reason: "rate_limited", pagesFetched, rowsWritten };
    }

    // 1. confirmar lease válida ANTES do request.
    if (!(await deps.heartbeat(task.id, task.leaseToken))) {
      return { kind: "refused", reason: "ownership_lost", pagesFetched, rowsWritten };
    }

    // 2. request (1 página, já normalizada pelo adapter).
    let page: FetchPageResult;
    try {
      page = await deps.fetchPage({
        adAccountId: task.adAccountId,
        level: task.level,
        dateFrom: task.dateFrom,
        dateTo: task.dateTo,
        cursor,
      });
    } catch (err) {
      const kind = errorKindFrom(err);
      const errorCode = errorCodeFrom(err);
      if (kind === "token_revoked" && deps.markReauthRequired) {
        await deps.markReauthRequired();
      }
      return failWithFencing(deps, task, errorCode, kind, pagesFetched, rowsWritten);
    }
    pagesFetched += 1;

    // 3. antes de escrever, confirmar ownership DE NOVO.
    if (!(await deps.heartbeat(task.id, task.leaseToken))) {
      return { kind: "refused", reason: "ownership_lost", pagesFetched, rowsWritten };
    }

    // 4. normalizar já veio pronto -> upsert (idempotente pela natural key).
    if (page.rows.length > 0) {
      const { rowsWritten: written } = await deps.upsertRows(dedupeRows(page.rows));
      rowsWritten += written;
    }

    // 5. paginação segura.
    if (page.nextCursor === null) break;
    if (seenCursors.has(page.nextCursor)) {
      return failWithFencing(
        deps,
        task,
        "pagination_loop_detected",
        "unknown",
        pagesFetched,
        rowsWritten,
      );
    }
    seenCursors.add(page.nextCursor);
    if (pagesFetched >= maxPages) {
      return failWithFencing(
        deps,
        task,
        "pagination_overflow",
        "unknown",
        pagesFetched,
        rowsWritten,
      );
    }
    cursor = page.nextCursor;
  }

  // zero data = nenhuma página teve linha alguma -> skipped_no_data (não é erro).
  const outcome: "done" | "skipped_no_data" = rowsWritten > 0 ? "done" : "skipped_no_data";
  const ok = await deps.completeSegment({
    segmentId: task.id,
    leaseToken: task.leaseToken,
    rowsWritten,
    pagesFetched,
    outcome,
  });
  if (!ok) return { kind: "refused", reason: "ownership_lost", pagesFetched, rowsWritten };
  return outcome === "done"
    ? { kind: "completed", rowsWritten, pagesFetched }
    : { kind: "skipped_no_data", pagesFetched };
}
