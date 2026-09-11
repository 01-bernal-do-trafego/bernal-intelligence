/**
 * Edge Function: meta-backfill-executor (DATA V2.2.3 — Historical Backfill)
 * ---------------------------------------------------------------------------
 * Processa NO MÁXIMO 1 `meta_backfill_segment` por invocação. NÃO cria jobs,
 * NÃO planeja histórico, NÃO faz loop, NÃO vira Cron — 1 invocação = 1
 * tentativa de 1 segmento (ou `idle` se não houver nenhum elegível agora).
 *
 *   POST { jobId?: string }
 *   header: x-meta-backfill-executor-secret: <META_BACKFILL_EXECUTOR_SECRET>
 *
 * `verify_jwt = false` — igual a `meta-sync-scheduled`: NENHUM usuário chama
 * isto diretamente; autorização = secret dedicado de alta entropia, tempo
 * constante. Deliberadamente um secret PRÓPRIO (não `META_SYNC_CRON_SECRET`)
 * — invocação manual/piloto do Backfill é um limite de confiança distinto do
 * Cron do Current Sync.
 *
 * O DEPLOY DEVE USAR `--no-verify-jwt` (MESMA frase/mesmo mecanismo de
 * `meta-sync-scheduled/index.ts`). Este projeto NÃO usa `supabase/config.toml`
 * para nenhuma Edge Function (não existe o arquivo) — `verify_jwt` é sempre
 * uma flag de `supabase functions deploy`, documentada aqui, nunca em config
 * versionado. Não introduzir `config.toml` só para esta função criaria DOIS
 * mecanismos divergentes para a MESMA coisa dentro do mesmo projeto.
 *
 * CLAIM: sempre via RPC `claim_next_backfill_segment` (control plane
 * DATA V2.2.1/V2.2.2) — nunca aceita `segment_id` do chamador. `jobId` é
 * opcional (reivindica dentro de 1 job específico); sem ele, reivindica o
 * próximo segmento elegível de QUALQUER job `running`.
 *
 * ALGORITMO — espelha `lib/backfill/executor.ts#executeBackfillSegment`
 * PASSO A PASSO (fronteira Deno não importa de `lib/`, ver comentário no
 * topo daquele arquivo — mantenha os dois em sync se um mudar):
 *
 *   is_linked -> rate check -> [por página: heartbeat -> fetch (1 página,
 *   já normalizada por toDailyRows) -> heartbeat -> upsert] -> complete/fail
 *
 * REUSO (nenhum normalizador/mapeamento de actions/cliente HTTP duplicado):
 *   - `listInsightsPage` / `insightFields` (`_shared/graph.ts`) — MESMO
 *     cliente HTTP do Current Sync, 1 página por vez (extraído em V2.2.3,
 *     `listEdge`/`listInsights` continuam com o MESMO comportamento).
 *   - `toDailyRows` (`_shared/insights.ts`) — MESMO normalizador do Current
 *     Sync (que por sua vez usa `normalizeActions`/`_shared/actions.ts`).
 *   - `classifyGraphError` (`_shared/graph.ts`) — MESMA classificação de
 *     erro; este arquivo NÃO reclassifica nada a partir do código bruto.
 *   - `openToken` (`_shared/crypto.ts`) — MESMA descriptografia AES-256-GCM.
 *
 * TOKEN/SECRET: mesmo padrão de sync-core.ts — token descriptografado só em
 * memória desta invocação; NUNCA retornado, NUNCA logado, NUNCA persistido
 * em claro. O resultado HTTP e todo `console.log` contêm SOMENTE identificadores
 * operacionais (segment/job/client id, fase, página, linhas, duração, classe
 * de erro) — nunca token/secret/lease_token.
 *
 * NÃO altera Current Sync: `sync-core.ts`, `meta-sync/index.ts`,
 * `meta-sync-scheduled/index.ts`, Cron, `meta_sync_release`,
 * `meta_client_sync_health` — nenhum tocado por este arquivo.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolveSecretKey } from "../_shared/supabase.ts";
import { openToken } from "../_shared/crypto.ts";
import { classifyGraphError, GraphApiError, getRateUsage, listInsightsPage, resetRateUsage } from "../_shared/graph.ts";
import { toDailyRows, type InsightLevel } from "../_shared/insights.ts";

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

/** Mesmo teto defensivo de `lib/backfill/executor.ts#DEFAULT_MAX_PAGES` / `listEdge`. */
const MAX_PAGES = 200;

/**
 * Backoff por categoria — MESMA tabela de `lib/backfill/error-classification.ts`
 * (Deno não importa de `lib/`; mantenha os dois em sync se um mudar).
 */
type ErrorKind = "token_revoked" | "insufficient_permission" | "rate_limited" | "transient" | "unknown";
const BACKOFF_MINUTES: Record<ErrorKind, number> = {
  rate_limited: 30,
  transient: 5,
  unknown: 15,
  token_revoked: 60,
  insufficient_permission: 60,
};
function nextRetryAt(kind: ErrorKind): string {
  return new Date(Date.now() + BACKOFF_MINUTES[kind] * 60_000).toISOString();
}

/**
 * Mesmo limiar conservador de `lib/backfill/rate-limit.ts#canRunBackfill`
 * (Deno não importa de `lib/`; mantenha os dois em sync se um mudar).
 */
function canRunBackfillNow(): boolean {
  const usage = getRateUsage();
  if (usage.throttled) return false;
  return usage.app_max_pct < 60 && usage.ad_account_max_pct < 60;
}

/** compara duas strings em tempo constante (mesmo padrão de meta-sync-scheduled). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
type AnyClient = any;

interface ClaimedSegment {
  segment_id: string;
  job_id: string;
  client_id: string;
  ad_account_ref: string;
  level: InsightLevel;
  date_from: string;
  date_to: string;
  attempt_count: number;
  lease_token: string;
}

function safeLog(event: string, fields: Record<string, unknown>) {
  // SOMENTE identificadores operacionais — nunca token/secret/lease_token bruto.
  console.log(JSON.stringify({ event, ...fields }));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const startedAt = Date.now();

  let SUPABASE_URL: string;
  let SECRET_KEY: string;
  let ENC_KEY: string;
  let EXECUTOR_SECRET: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
    EXECUTOR_SECRET = requireEnv("META_BACKFILL_EXECUTOR_SECRET");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  const provided = req.headers.get("x-meta-backfill-executor-secret") ?? "";
  if (!provided || !timingSafeEqual(provided, EXECUTOR_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;

  const admin: AnyClient = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- CLAIM — sempre pela RPC do control plane. Nunca aceita segment_id do chamador. ----
  const { data: claimRows, error: claimErr } = await admin.rpc("claim_next_backfill_segment", {
    p_job_id: jobId,
  });
  if (claimErr) {
    return json({ status: "error", reason: "claim_failed" }, 500);
  }
  const seg = (claimRows as ClaimedSegment[] | null)?.[0] ?? null;
  if (!seg) {
    return json({ status: "idle" }, 200);
  }
  safeLog("segment_claimed", {
    segmentId: seg.segment_id,
    jobId: seg.job_id,
    clientId: seg.client_id,
    level: seg.level,
    dateFrom: seg.date_from,
    dateTo: seg.date_to,
  });

  const fail = async (kind: ErrorKind, errorCode: string, pagesFetched: number, rowsWritten: number) => {
    const ok = await admin.rpc("fail_backfill_segment", {
      p_segment_id: seg.segment_id,
      p_lease_token: seg.lease_token,
      p_error_code: errorCode,
      p_next_retry_at: nextRetryAt(kind),
    });
    const ownershipLost = ok.error != null || ok.data !== true;
    safeLog("segment_failed", {
      segmentId: seg.segment_id,
      jobId: seg.job_id,
      errorClass: kind,
      pagesFetched,
      rowsWritten,
      ownershipLost,
    });
    return json(
      {
        segment_id: seg.segment_id,
        job_id: seg.job_id,
        level: seg.level,
        date_from: seg.date_from,
        date_to: seg.date_to,
        status: ownershipLost ? "refused" : "failed",
        pages_fetched: pagesFetched,
        rows_written: rowsWritten,
        duration_ms: Date.now() - startedAt,
        error_class: kind,
        ownership_lost: ownershipLost,
      },
      200,
    );
  };

  const refused = (reason: string, pagesFetched: number, rowsWritten: number) =>
    json(
      {
        segment_id: seg.segment_id,
        job_id: seg.job_id,
        level: seg.level,
        date_from: seg.date_from,
        date_to: seg.date_to,
        status: "refused",
        pages_fetched: pagesFetched,
        rows_written: rowsWritten,
        duration_ms: Date.now() - startedAt,
        error_class: null,
        ownership_lost: reason === "ownership_lost",
        reason,
      },
      200,
    );

  // ---- validar conta/conexão (mesmo padrão de tokenErr em sync-core.ts) ----
  const { data: accRow } = await admin
    .from("meta_ad_accounts")
    .select("id, ad_account_id, connection_id, currency, is_linked")
    .eq("id", seg.ad_account_ref)
    .maybeSingle();
  const acc = accRow as
    | { id: string; ad_account_id: string; connection_id: string | null; currency: string | null; is_linked: boolean }
    | null;
  if (!acc || !acc.is_linked) {
    return await fail("unknown", "account_not_linked", 0, 0);
  }
  if (!acc.connection_id) {
    return await fail("unknown", "no_connection", 0, 0);
  }

  // MESMA regra de elegibilidade de `meta_eligible_ad_accounts` (Auto Sync V1,
  // `20260903193000_meta_auto_sync.sql`): status IN ('active','expiring').
  // Não reutilizamos a VIEW em si — ela filtra a partir de meta_ad_accounts
  // (usada para DESCOBRIR contas elegíveis), enquanto aqui a conta já foi
  // resolvida pelo claim (control plane V2.2.1/V2.2.2); consultar direto por
  // connection_id é mais simples e não acopla a validação do segmento já
  // reivindicado a uma view pensada para outro propósito. A LISTA de status
  // aceitos é a MESMA — mantenha em sync se a view mudar.
  const ELIGIBLE_CONNECTION_STATUSES = ["active", "expiring"] as const;
  const { data: connRow } = await admin
    .from("meta_connections")
    .select("status")
    .eq("id", acc.connection_id)
    .maybeSingle();
  const conn = connRow as { status: string } | null;
  if (!conn || !ELIGIBLE_CONNECTION_STATUSES.includes(conn.status as (typeof ELIGIBLE_CONNECTION_STATUSES)[number])) {
    // A conexão já está no estado correto (reauthorization_required/revoked/...) —
    // NÃO reescrevemos o status aqui, só recusamos avançar. markReauthRequired
    // (abaixo) é só para quando ESTA invocação DESCOBRE um problema novo.
    return await fail("unknown", "connection_not_eligible", 0, 0);
  }

  const { data: secretRow } = await admin
    .from("meta_connection_secrets")
    .select("token_cipher, token_iv, token_tag")
    .eq("connection_id", acc.connection_id)
    .maybeSingle();
  const sec = secretRow as { token_cipher: string; token_iv: string; token_tag: string } | null;

  const markReauthRequired = async (reason: string) => {
    await admin
      .from("meta_connections")
      .update({
        status: "reauthorization_required",
        status_reason: reason,
        last_error: reason,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", acc.connection_id);
  };

  let token: string | null = null;
  if (!sec) {
    await markReauthRequired("no_connection_secret"); // mesma abstração de sync-core.ts
    return await fail("unknown", "no_connection_secret", 0, 0);
  }
  try {
    token = await openToken({ cipher: sec.token_cipher, iv: sec.token_iv, tag: sec.token_tag }, ENC_KEY);
  } catch {
    await markReauthRequired("decrypt_failed"); // mesma abstração de sync-core.ts
    return await fail("unknown", "decrypt_failed", 0, 0);
  }

  // ---- loop de páginas — espelha lib/backfill/executor.ts PASSO A PASSO ----
  resetRateUsage();
  const graph = { graphBase: GRAPH_BASE, version: GRAPH_VERSION, token };
  let cursor: string | null = null;
  let pagesFetched = 0;
  let rowsWritten = 0;
  const seenCursors = new Set<string>();

  const heartbeat = async (): Promise<boolean> => {
    const { data, error } = await admin.rpc("extend_backfill_segment_lease", {
      p_segment_id: seg.segment_id,
      p_lease_token: seg.lease_token,
    });
    return error == null && data === true;
  };

  for (;;) {
    if (!canRunBackfillNow()) return refused("rate_limited", pagesFetched, rowsWritten);

    // 1. confirmar lease válida ANTES do request.
    if (!(await heartbeat())) return refused("ownership_lost", pagesFetched, rowsWritten);

    // 2. request — 1 página, já com rate usage capturado internamente.
    let rawRows: unknown[];
    let nextCursor: string | null;
    try {
      const page = await listInsightsPage({
        ...graph,
        adAccountId: acc.ad_account_id,
        level: seg.level,
        timeRange: { since: seg.date_from, until: seg.date_to },
        timeIncrement: "1",
        cursor,
      });
      rawRows = page.rows;
      nextCursor = page.nextCursor;
    } catch (err) {
      const kind: ErrorKind = err instanceof GraphApiError ? err.kind : "unknown";
      if (kind === "token_revoked") await markReauthRequired("token_revoked");
      const code = err instanceof Error ? err.message.slice(0, 200) : "unknown_error";
      return await fail(kind, code, pagesFetched, rowsWritten);
    }
    pagesFetched += 1;

    // 3. antes de escrever, confirmar ownership DE NOVO.
    if (!(await heartbeat())) return refused("ownership_lost", pagesFetched, rowsWritten);

    // 4. normalizar (MESMO normalizador do Current Sync) -> upsert (idempotente pela natural key).
    const normalized = toDailyRows(rawRows, {
      clientId: seg.client_id,
      adAccountRef: acc.id,
      adAccountId: acc.ad_account_id,
      level: seg.level,
      attributionWindow: "unified_attribution",
      currency: acc.currency,
    });
    if (normalized.length > 0) {
      const { error: upsertErr } = await admin
        .from("meta_insights_daily")
        .upsert(normalized, { onConflict: "level,entity_id,date,attribution_window" });
      if (upsertErr) {
        return await fail("unknown", `upsert_failed: ${String(upsertErr.message).slice(0, 150)}`, pagesFetched, rowsWritten);
      }
      rowsWritten += normalized.length;
    }
    safeLog("page_processed", { segmentId: seg.segment_id, page: pagesFetched, rows: normalized.length });

    // 5. paginação segura.
    if (nextCursor === null) break;
    if (seenCursors.has(nextCursor)) {
      return await fail("unknown", "pagination_loop_detected", pagesFetched, rowsWritten);
    }
    seenCursors.add(nextCursor);
    if (pagesFetched >= MAX_PAGES) {
      return await fail("unknown", "pagination_overflow", pagesFetched, rowsWritten);
    }
    cursor = nextCursor;
  }

  // ---- fechamento: zero data = skipped_no_data (não é erro) ----
  const outcome: "done" | "skipped_no_data" = rowsWritten > 0 ? "done" : "skipped_no_data";
  const { data: completeOk, error: completeErr } = await admin.rpc("complete_backfill_segment", {
    p_segment_id: seg.segment_id,
    p_lease_token: seg.lease_token,
    p_rows_written: rowsWritten,
    p_pages_fetched: pagesFetched,
    p_outcome: outcome,
  });
  if (completeErr || completeOk !== true) {
    return refused("ownership_lost", pagesFetched, rowsWritten);
  }

  safeLog("segment_completed", {
    segmentId: seg.segment_id,
    jobId: seg.job_id,
    outcome,
    pagesFetched,
    rowsWritten,
  });

  return json(
    {
      segment_id: seg.segment_id,
      job_id: seg.job_id,
      level: seg.level,
      date_from: seg.date_from,
      date_to: seg.date_to,
      status: outcome,
      pages_fetched: pagesFetched,
      rows_written: rowsWritten,
      duration_ms: Date.now() - startedAt,
      error_class: null,
      ownership_lost: false,
    },
    200,
  );
});
