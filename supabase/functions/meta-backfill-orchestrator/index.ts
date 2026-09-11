/**
 * Edge Function: meta-backfill-orchestrator (DATA V2.3A — Historical Backfill Rollout)
 * ---------------------------------------------------------------------------
 * Operação administrativa que elimina criar job/segmentos manualmente no
 * SQL Editor. NÃO busca insights Meta, NÃO executa segmento nenhum — isso
 * continua sendo, exclusivamente, `meta-backfill-executor` (V2.2.3).
 *
 *   POST { action: "inspect", clientId, adAccountRef }
 *   POST { action: "create", clientId, adAccountRef, requestedLevels, targetStartDate, targetEndDate, segments }
 *   POST { action: "status", jobId }
 *   header: x-meta-backfill-orchestrator-secret: <META_BACKFILL_ORCHESTRATOR_SECRET>
 *
 * `verify_jwt = false` — MESMO padrão de `meta-sync-scheduled`/
 * `meta-backfill-executor`: NENHUM usuário chama isto diretamente;
 * autorização = secret DEDICADO (`META_BACKFILL_ORCHESTRATOR_SECRET`, não
 * reaproveita nenhum outro secret), tempo constante. O DEPLOY DEVE USAR
 * `--no-verify-jwt` (mesma frase/mecanismo de `meta-sync-scheduled`; este
 * projeto NÃO usa `supabase/config.toml` para nenhuma Edge Function).
 *
 * SEM SEGUNDO PLANNER: `create` só MATERIALIZA um `SegmentPlan[]` já
 * calculado pelo chamador (o runner/CLI, usando
 * `lib/backfill/planner.ts#planBackfillSegments` — a ÚNICA fonte de
 * verdade de segmentação) via a RPC atômica
 * `create_backfill_job_with_segments` (DATA V2.3A,
 * `20260911173000_meta_backfill_create_job_with_segments.sql`). Esta Edge
 * Function não decide blocos, não decide datas — só valida a FORMA do
 * payload e delega a validação SEMÂNTICA completa (overlap/gap/coverage/
 * conta/job ativo) para a RPC (server-side, não confia no cliente).
 *
 * TOKEN/SECRET: nunca lida, nunca resolvida aqui — esta função NUNCA toca
 * `meta_connection_secrets`/`openToken`. `inspect` só LÊ `has_secret`
 * (boolean) e `status` da conexão, nunca o segredo em si.
 *
 * service_role só existe dentro desta função (nunca chega ao browser, nunca
 * aparece em log/resposta). Logs (`safeLog`) e respostas contêm SOMENTE
 * identificadores operacionais — nunca token/secret.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolveSecretKey } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const VALID_LEVELS = new Set(["account", "campaign", "adset", "ad"]);
/** MESMA regra de meta_eligible_ad_accounts (Auto Sync V1) — mantenha em sync se a view mudar. */
const ELIGIBLE_CONNECTION_STATUSES = ["active", "expiring"] as const;

/** compara duas strings em tempo constante (mesmo padrão de meta-sync-scheduled/meta-backfill-executor). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function safeLog(event: string, fields: Record<string, unknown>) {
  // SOMENTE identificadores operacionais — nunca token/secret.
  console.log(JSON.stringify({ event, ...fields }));
}

interface InspectBody {
  action: "inspect";
  clientId?: unknown;
  adAccountRef?: unknown;
}
interface CreateBody {
  action: "create";
  clientId?: unknown;
  adAccountRef?: unknown;
  requestedLevels?: unknown;
  targetStartDate?: unknown;
  targetEndDate?: unknown;
  segments?: unknown;
}
interface StatusBody {
  action: "status";
  jobId?: unknown;
}
type Body = InspectBody | CreateBody | StatusBody;

async function handleInspect(admin: AnyClient, body: InspectBody) {
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const adAccountRef = typeof body.adAccountRef === "string" ? body.adAccountRef.trim() : "";
  if (!clientId || !adAccountRef) return json({ error: "bad_request", detail: "clientId e adAccountRef são obrigatórios" }, 400);

  const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return json({ error: "client_not_found" }, 404);

  const { data: accRow } = await admin
    .from("meta_ad_accounts")
    .select("id, ad_account_id, connection_id, is_linked, client_id")
    .eq("id", adAccountRef)
    .maybeSingle();
  const acc = accRow as
    | { id: string; ad_account_id: string; connection_id: string | null; is_linked: boolean; client_id: string }
    | null;
  if (!acc || acc.client_id !== clientId) {
    return json({ error: "account_not_found_for_client" }, 404);
  }
  if (!acc.is_linked) {
    return json({ error: "account_not_linked" }, 409);
  }
  if (!acc.connection_id) {
    return json({ error: "no_connection" }, 409);
  }

  const { data: connRow } = await admin
    .from("meta_connections")
    .select("status, has_secret")
    .eq("id", acc.connection_id)
    .maybeSingle();
  const conn = connRow as { status: string; has_secret: boolean } | null;
  if (!conn) return json({ error: "connection_not_found" }, 409);

  const connectionEligible = ELIGIBLE_CONNECTION_STATUSES.includes(
    conn.status as (typeof ELIGIBLE_CONNECTION_STATUSES)[number],
  );

  const [{ count: campaignCount }, { count: adsetCount }, { count: adCount }] = await Promise.all([
    admin.from("meta_campaigns").select("id", { count: "exact", head: true }).eq("ad_account_ref", adAccountRef),
    admin.from("meta_adsets").select("id", { count: "exact", head: true }).eq("ad_account_ref", adAccountRef),
    admin.from("meta_ads").select("id", { count: "exact", head: true }).eq("ad_account_ref", adAccountRef),
  ]);

  const { data: activeJobRow } = await admin
    .from("meta_backfill_jobs")
    .select("id")
    .eq("ad_account_ref", adAccountRef)
    .in("status", ["pending", "running", "paused"])
    .maybeSingle();

  const { data: syncRunRow } = await admin
    .from("meta_sync_runs")
    .select("id")
    .eq("ad_account_ref", adAccountRef)
    .eq("status", "running")
    .maybeSingle();

  safeLog("inspect", { clientId, adAccountRef, connectionEligible, hasSecret: conn.has_secret });

  return json({
    clientId,
    adAccountRef,
    metaAccountId: acc.ad_account_id,
    connectionStatus: conn.status,
    connectionEligible: connectionEligible && conn.has_secret === true,
    entityCounts: {
      account: 1,
      campaign: campaignCount ?? 0,
      adset: adsetCount ?? 0,
      ad: adCount ?? 0,
    },
    activeJob: Boolean(activeJobRow),
    jobId: (activeJobRow as { id: string } | null)?.id ?? null,
    currentSyncRunning: Boolean(syncRunRow),
  });
}

async function handleCreate(admin: AnyClient, body: CreateBody) {
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const adAccountRef = typeof body.adAccountRef === "string" ? body.adAccountRef.trim() : "";
  const requestedLevels = Array.isArray(body.requestedLevels) ? body.requestedLevels : null;
  const targetStartDate = typeof body.targetStartDate === "string" ? body.targetStartDate : null;
  const targetEndDate = typeof body.targetEndDate === "string" ? body.targetEndDate : null;
  const segments = Array.isArray(body.segments) ? body.segments : null;

  if (!clientId || !adAccountRef) {
    return json({ error: "bad_request", detail: "clientId e adAccountRef são obrigatórios" }, 400);
  }
  if (!requestedLevels || requestedLevels.length === 0 || !requestedLevels.every((l) => typeof l === "string" && VALID_LEVELS.has(l))) {
    return json({ error: "bad_request", detail: "requestedLevels inválido" }, 400);
  }
  if (!targetStartDate || !targetEndDate) {
    return json(
      { error: "bad_request", detail: "targetStartDate/targetEndDate são obrigatórios — discovery é a DATA V2.3B" },
      400,
    );
  }
  if (!segments || segments.length === 0) {
    return json({ error: "bad_request", detail: "segments não pode ser vazio" }, 400);
  }
  // valida só a FORMA — a semântica (overlap/gap/coverage/conta/job ativo) é
  // responsabilidade da RPC (server-side, não confia neste payload).
  const pSegments: Array<{ level: string; date_from: string; date_to: string }> = [];
  for (const seg of segments) {
    if (
      typeof seg !== "object" ||
      seg === null ||
      typeof (seg as Record<string, unknown>).level !== "string" ||
      !VALID_LEVELS.has((seg as Record<string, unknown>).level as string) ||
      typeof (seg as Record<string, unknown>).dateFrom !== "string" ||
      typeof (seg as Record<string, unknown>).dateTo !== "string"
    ) {
      return json({ error: "bad_request", detail: "segmento malformado (level/dateFrom/dateTo)" }, 400);
    }
    const s = seg as { level: string; dateFrom: string; dateTo: string };
    pSegments.push({ level: s.level, date_from: s.dateFrom, date_to: s.dateTo });
  }

  const { data, error } = await admin.rpc("create_backfill_job_with_segments", {
    p_client_id: clientId,
    p_ad_account_ref: adAccountRef,
    p_requested_levels: requestedLevels,
    p_target_start_date: targetStartDate,
    p_target_end_date: targetEndDate,
    p_segments: pSegments,
  });

  if (error) {
    // mensagem da RPC já é sanitizada/amigável por desenho (raise exception
    // com texto próprio, nunca SQL bruto/stack) — só truncamos por segurança.
    const detail = String(error.message ?? "create_failed").slice(0, 300);
    safeLog("create_failed", { clientId, adAccountRef, detail });
    return json({ error: "create_failed", detail }, 409);
  }

  const row = (data as Array<{ job_id: string; segment_count: number }> | null)?.[0] ?? null;
  if (!row) return json({ error: "create_failed", detail: "RPC não devolveu job_id" }, 500);

  safeLog("job_created", { clientId, adAccountRef, jobId: row.job_id, segmentCount: row.segment_count });

  return json({
    jobId: row.job_id,
    segmentCount: row.segment_count,
    status: "running",
    range: { from: targetStartDate, to: targetEndDate },
    levels: requestedLevels,
  });
}

async function handleStatus(admin: AnyClient, body: StatusBody) {
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) return json({ error: "bad_request", detail: "jobId é obrigatório" }, 400);

  // reutiliza meta_backfill_progress (DATA V2.2.1) — nenhum contador é
  // recalculado/duplicado aqui.
  const { data: progressRow } = await admin
    .from("meta_backfill_progress")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!progressRow) return json({ error: "job_not_found" }, 404);

  const { data: jobRow } = await admin
    .from("meta_backfill_jobs")
    .select("requested_levels")
    .eq("id", jobId)
    .maybeSingle();

  const p = progressRow as {
    job_id: string;
    job_status: string;
    segments_total: number;
    segments_pending: number;
    segments_running: number;
    segments_done: number;
    segments_failed: number;
    segments_skipped: number;
    progress_percent: number | null;
    target_start_date: string;
    target_end_date: string;
  };

  return json({
    jobId: p.job_id,
    jobStatus: p.job_status,
    totalSegments: p.segments_total,
    pending: p.segments_pending,
    running: p.segments_running,
    done: p.segments_done,
    skippedNoData: p.segments_skipped,
    failed: p.segments_failed,
    dateFrom: p.target_start_date,
    dateTo: p.target_end_date,
    levels: (jobRow as { requested_levels: string[] } | null)?.requested_levels ?? [],
    progressPct: p.progress_percent,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let SUPABASE_URL: string;
  let SECRET_KEY: string;
  let ORCHESTRATOR_SECRET: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    SECRET_KEY = resolveSecretKey();
    ORCHESTRATOR_SECRET = requireEnv("META_BACKFILL_ORCHESTRATOR_SECRET");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  const provided = req.headers.get("x-meta-backfill-orchestrator-secret") ?? "";
  if (!provided || !timingSafeEqual(provided, ORCHESTRATOR_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);

  const admin: AnyClient = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  switch (body.action) {
    case "inspect":
      return await handleInspect(admin, body);
    case "create":
      return await handleCreate(admin, body);
    case "status":
      return await handleStatus(admin, body);
    default:
      return json({ error: "bad_request", detail: "action inválida (inspect|create|status)" }, 400);
  }
});
