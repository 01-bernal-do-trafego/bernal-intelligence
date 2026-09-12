/**
 * Núcleo de sincronização Meta — compartilhado entre `meta-sync` (manual, JWT
 * de usuário) e `meta-sync-scheduled` (backend, secret do cron). Fronteira Deno.
 *
 * Uma execução de UM cliente:
 *   1. meta_sync_gc_stale (limpa runs presos > 20 min)
 *   2. meta_sync_acquire_client — ATÔMICO: cria 1 meta_sync_runs por conta
 *      ELEGÍVEL (is_linked + connection válida active/expiring + secret), todos
 *      com o MESMO sync_batch_id; cada run guarda a connection_id da própria
 *      conta. Qualquer conta já em `running` -> aborta tudo (sync_already_running).
 *   3. agrupa os runs por connection_id, abre 1 token por conexão (em memória)
 *   4. por conta: estrutura -> creatives INCREMENTAL -> relação ad↔creative
 *      (last_seen sempre) -> insights -> release.
 *
 * Token/secret NUNCA retornados nem logados. Rate limit: registra, encerra a
 * conta como partial/error, SEM retry agressivo — o próximo ciclo tenta de novo.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { openToken } from "./crypto.ts";
import { accountToday, addDays, isoDate } from "./date-util.ts";
import {
  GraphApiError,
  GraphPaginationOverflow,
  getRateUsage,
  listEdge,
  listInsights,
  resetRateUsage,
} from "./graph.ts";
import { toDailyRows, toPeriodicRows, type InsightLevel } from "./insights.ts";
import { creativeDbRow } from "./creatives.ts";
import {
  creativesStageOutcome,
  graphCreativeTransport,
  linkStageOutcome,
  planAdCreativeLinks,
  planCreativeFetch,
} from "./creatives-fetch.ts";

const ATTR_WINDOW = "unified_attribution";
const CREATIVE_DETAILS_TTL_HOURS = 24;

const PERIODIC_PRESETS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
] as const;
type PeriodicPreset = (typeof PERIODIC_PRESETS)[number];

const CAMPAIGN_FIELDS =
  "id,account_id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,start_time,stop_time";
const ADSET_FIELDS =
  "id,campaign_id,account_id,name,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,promoted_object,created_time,updated_time";
const AD_FIELDS =
  "id,adset_id,campaign_id,account_id,name,status,effective_status,creative{id},created_time,updated_time";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function ts(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function dailyHorizon(today: string): { from: string; to: string } {
  const minus30 = addDays(today, -30);
  const [yy, mm] = today.split("-").map(Number);
  const py = mm === 1 ? yy - 1 : yy;
  const pm = mm === 1 ? 12 : mm - 1;
  const prevMonth = `${py}-${String(pm).padStart(2, "0")}-01`;
  return { from: minus30 < prevMonth ? minus30 : prevMonth, to: today };
}

function presetRange(
  preset: PeriodicPreset,
  today: string,
): { from: string; to: string } {
  const y = addDays(today, -1);
  const [yy, mm] = today.split("-").map(Number);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: y, to: y };
    case "last_7d":
      return { from: addDays(y, -6), to: y };
    case "last_14d":
      return { from: addDays(y, -13), to: y };
    case "last_30d":
      return { from: addDays(y, -29), to: y };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const start = new Date(Date.UTC(yy, mm - 2, 1));
      const end = new Date(Date.UTC(yy, mm - 1, 0));
      return { from: isoDate(start), to: isoDate(end) };
    }
  }
}

/* ================================================================== */

export interface SyncEnvConfig {
  supabaseUrl: string;
  secretKey: string;
  encKey: string;
  graphBase: string;
  graphVersion: string;
}
export interface RunClientSyncOpts {
  clientId: string;
  trigger: "manual" | "cron" | "backfill";
  createdBy: string | null;
}
export interface RunClientSyncResult {
  ok: boolean;
  reason?: string;
  /**
   * true  = skip ESPERADO (sync_already_running / no_eligible_account).
   * false num resultado `ok:false` = erro INESPERADO (não pode virar skip).
   */
  skip?: boolean;
  /** fase do erro inesperado (ex. "acquire"). */
  phase?: string;
  /** SQLSTATE sanitizado (5 chars) quando disponível — nunca SQL/message bruta. */
  code?: string;
  batchId?: string;
  dateFrom?: string;
  dateTo?: string;
  results: Array<Record<string, unknown>>;
}

interface AcquireRow {
  ad_account_ref: string;
  connection_id: string;
  run_id: string;
  sync_batch_id: string;
}
interface AccountRow {
  id: string;
  ad_account_id: string;
  currency: string | null;
  timezone_name: string | null;
}

export async function runClientSync(
  env: SyncEnvConfig,
  opts: RunClientSyncOpts,
): Promise<RunClientSyncResult> {
  const admin: AnyClient = createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { clientId, trigger, createdBy } = opts;

  // 1. limpa runs presos (transação própria)
  try {
    await admin.rpc("meta_sync_gc_stale", { p_client_id: clientId });
  } catch {
    // não bloqueia
  }

  // range do envelope (metadados do run; a janela real é por conta no fuso dela)
  const envelope = dailyHorizon(accountToday(null));

  // 2. acquire ATÔMICO do cliente inteiro
  const { data: acq, error: acqErr } = await admin.rpc("meta_sync_acquire_client", {
    p_client_id: clientId,
    p_trigger: trigger,
    p_date_from: envelope.from,
    p_date_to: envelope.to,
    p_created_by: createdBy,
  });
  if (acqErr) {
    // `msg` só serve para casar os sentinelas — NUNCA é retornado/logado.
    const msg = String(acqErr.message ?? "");
    if (msg.includes("sync_already_running")) {
      return { ok: false, reason: "sync_already_running", skip: true, results: [] };
    }
    if (msg.includes("no_eligible_account")) {
      return { ok: false, reason: "no_eligible_account", skip: true, results: [] };
    }
    // erro INESPERADO de acquire -> não vira skip. Só o SQLSTATE (5 chars) sai.
    const rawCode = (acqErr as { code?: unknown }).code;
    const code =
      typeof rawCode === "string" && /^[0-9A-Za-z]{5}$/.test(rawCode) ? rawCode : undefined;
    return {
      ok: false,
      reason: "acquire_failed",
      skip: false,
      phase: "acquire",
      ...(code ? { code } : {}),
      results: [],
    };
  }
  const rows = (acq ?? []) as AcquireRow[];
  if (rows.length === 0) {
    return { ok: false, reason: "no_eligible_account", skip: true, results: [] };
  }
  const batchId = rows[0].sync_batch_id;

  // 3. agrupa por connection_id
  const byConn = new Map<string, AcquireRow[]>();
  for (const r of rows) {
    const list = byConn.get(r.connection_id);
    if (list) list.push(r);
    else byConn.set(r.connection_id, [r]);
  }

  const results: Array<Record<string, unknown>> = [];
  let envelopeRange = envelope;

  for (const [connectionId, connRows] of byConn) {
    // token da conexão (em memória)
    const { data: secret } = await admin
      .from("meta_connection_secrets")
      .select("token_cipher, token_iv, token_tag")
      .eq("connection_id", connectionId)
      .maybeSingle();
    const sec = secret as
      | { token_cipher: string; token_iv: string; token_tag: string }
      | null;
    let token: string | null = null;
    let tokenErr: string | null = null;
    if (!sec) {
      tokenErr = "no_connection_secret";
    } else {
      try {
        token = await openToken(
          { cipher: sec.token_cipher, iv: sec.token_iv, tag: sec.token_tag },
          env.encKey,
        );
      } catch {
        tokenErr = "decrypt_failed";
      }
    }

    const { data: accs } = await admin
      .from("meta_ad_accounts")
      .select("id, ad_account_id, currency, timezone_name")
      .in("id", connRows.map((r) => r.ad_account_ref));
    const accById = new Map<string, AccountRow>(
      ((accs ?? []) as AccountRow[]).map((a) => [a.id, a]),
    );

    for (const r of connRows) {
      const acc = accById.get(r.ad_account_ref);
      if (tokenErr || !token || !acc) {
        const reason = tokenErr ?? "account_missing";
        await admin.rpc("meta_sync_release", {
          p_run_id: r.run_id,
          p_status: "error",
          p_stats: { status: "error", reason },
          p_error: reason,
        });
        if (tokenErr === "no_connection_secret" || tokenErr === "decrypt_failed") {
          await admin
            .from("meta_connections")
            .update({
              status: "reauthorization_required",
              status_reason: tokenErr,
              last_error: tokenErr,
              last_verified_at: new Date().toISOString(),
            })
            .eq("id", connectionId);
        }
        results.push({
          adAccountId: acc?.ad_account_id ?? r.ad_account_ref,
          runId: r.run_id,
          batchId,
          status: "error",
          error: reason,
        });
        continue;
      }
      const graph = {
        graphBase: env.graphBase,
        version: env.graphVersion,
        token,
      };
      const res = await syncOneAccount(admin, graph, {
        clientId,
        connectionId,
        runId: r.run_id,
        acc,
      });
      envelopeRange = res.range;
      results.push({
        adAccountId: acc.ad_account_id,
        runId: r.run_id,
        batchId,
        status: res.status,
        stats: res.stats,
        ...(res.fatal ? { error: res.fatal } : {}),
      });
    }
  }

  return {
    ok: true,
    batchId,
    dateFrom: envelopeRange.from,
    dateTo: envelopeRange.to,
    results,
  };
}

/* ---- uma conta -------------------------------------------------------- */

interface SyncAccountCtx {
  clientId: string;
  connectionId: string;
  runId: string;
  acc: AccountRow;
}
interface SyncAccountResult {
  status: "success" | "partial" | "error";
  stats: Record<string, unknown>;
  fatal: string | null;
  range: { from: string; to: string };
}

async function syncOneAccount(
  admin: AnyClient,
  graph: { graphBase: string; version: string; token: string },
  ctx: SyncAccountCtx,
): Promise<SyncAccountResult> {
  const { clientId, connectionId, runId, acc } = ctx;
  resetRateUsage();

  const today = accountToday(acc.timezone_name);
  const range = dailyHorizon(today);

  const stages: Array<{
    stage: string;
    outcome: string;
    rows?: number;
    pages?: number;
    detail?: Record<string, unknown>;
  }> = [];
  let fatal: string | null = null;
  let rateLimited: string | null = null;

  const noteGraphError = (e: unknown) => {
    if (e instanceof GraphApiError && e.kind === "token_revoked") {
      fatal = "token_revoked";
    } else if (e instanceof GraphApiError && e.kind === "rate_limited") {
      rateLimited = "rate_limited";
    }
  };
  const stop = () => fatal !== null || rateLimited !== null;

  const ctxFor = (level: InsightLevel) => ({
    clientId,
    adAccountRef: acc.id,
    adAccountId: acc.ad_account_id,
    level,
    attributionWindow: ATTR_WINDOW,
    currency: acc.currency,
  });

  // ---- estrutura ----------------------------------------------------
  let campaignRefByMetaId = new Map<string, string>();
  let adsetRefByMetaId = new Map<string, string>();

  try {
    const { rows, pages } = await listEdge({
      ...graph,
      path: `${acc.ad_account_id}/campaigns`,
      fields: CAMPAIGN_FIELDS,
    });
    const payload = rows
      .filter((r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null &&
        typeof (r as Record<string, unknown>).id === "string"
      )
      .map((r) => ({
        client_id: clientId,
        ad_account_ref: acc.id,
        ad_account_id: acc.ad_account_id,
        campaign_id: r.id as string,
        name: s(r.name),
        objective: s(r.objective),
        status: s(r.status),
        effective_status: s(r.effective_status),
        buying_type: s(r.buying_type),
        daily_budget: num(r.daily_budget),
        lifetime_budget: num(r.lifetime_budget),
        budget_remaining: num(r.budget_remaining),
        created_time: ts(r.created_time),
        updated_time: ts(r.updated_time),
        start_time: ts(r.start_time),
        stop_time: ts(r.stop_time),
        synced_at: new Date().toISOString(),
      }));
    if (payload.length) {
      const { error } = await admin
        .from("meta_campaigns")
        .upsert(payload, { onConflict: "campaign_id" });
      if (error) throw new Error(`upsert campaigns: ${error.message}`);
    }
    stages.push({ stage: "campaigns", outcome: "done", rows: payload.length, pages });
  } catch (e) {
    noteGraphError(e);
    stages.push({
      stage: "campaigns",
      outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
    });
  }

  if (!stop()) {
    const { data: crows } = await admin
      .from("meta_campaigns").select("id, campaign_id").eq("ad_account_ref", acc.id);
    campaignRefByMetaId = new Map(
      ((crows ?? []) as Array<{ id: string; campaign_id: string }>).map((r) => [
        r.campaign_id,
        r.id,
      ]),
    );
  }

  if (!stop()) {
    try {
      const { rows, pages } = await listEdge({
        ...graph,
        path: `${acc.ad_account_id}/adsets`,
        fields: ADSET_FIELDS,
      });
      const payload = rows
        .filter((r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null &&
          typeof (r as Record<string, unknown>).id === "string"
        )
        .map((r) => ({
          client_id: clientId,
          ad_account_ref: acc.id,
          campaign_ref: s(r.campaign_id)
            ? campaignRefByMetaId.get(r.campaign_id as string) ?? null
            : null,
          ad_account_id: acc.ad_account_id,
          campaign_id: s(r.campaign_id),
          adset_id: r.id as string,
          name: s(r.name),
          status: s(r.status),
          effective_status: s(r.effective_status),
          optimization_goal: s(r.optimization_goal),
          billing_event: s(r.billing_event),
          bid_strategy: s(r.bid_strategy),
          daily_budget: num(r.daily_budget),
          lifetime_budget: num(r.lifetime_budget),
          start_time: ts(r.start_time),
          end_time: ts(r.end_time),
          promoted_object: r.promoted_object ?? null,
          created_time: ts(r.created_time),
          updated_time: ts(r.updated_time),
          synced_at: new Date().toISOString(),
        }));
      if (payload.length) {
        const { error } = await admin
          .from("meta_adsets")
          .upsert(payload, { onConflict: "adset_id" });
        if (error) throw new Error(`upsert adsets: ${error.message}`);
      }
      stages.push({ stage: "adsets", outcome: "done", rows: payload.length, pages });
    } catch (e) {
      noteGraphError(e);
      stages.push({
        stage: "adsets",
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
      });
    }
  }

  if (!stop()) {
    const { data: arows } = await admin
      .from("meta_adsets").select("id, adset_id").eq("ad_account_ref", acc.id);
    adsetRefByMetaId = new Map(
      ((arows ?? []) as Array<{ id: string; adset_id: string }>).map((r) => [
        r.adset_id,
        r.id,
      ]),
    );
  }

  if (!stop()) {
    try {
      const { rows, pages } = await listEdge({
        ...graph,
        path: `${acc.ad_account_id}/ads`,
        fields: AD_FIELDS,
      });
      const payload = rows
        .filter((r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null &&
          typeof (r as Record<string, unknown>).id === "string"
        )
        .map((r) => {
          const creative = typeof r.creative === "object" && r.creative !== null
            ? (r.creative as Record<string, unknown>)
            : null;
          return {
            client_id: clientId,
            ad_account_ref: acc.id,
            campaign_ref: s(r.campaign_id)
              ? campaignRefByMetaId.get(r.campaign_id as string) ?? null
              : null,
            adset_ref: s(r.adset_id)
              ? adsetRefByMetaId.get(r.adset_id as string) ?? null
              : null,
            ad_account_id: acc.ad_account_id,
            campaign_id: s(r.campaign_id),
            adset_id: s(r.adset_id),
            ad_id: r.id as string,
            name: s(r.name),
            status: s(r.status),
            effective_status: s(r.effective_status),
            creative_id: creative ? s(creative.id) : null,
            created_time: ts(r.created_time),
            updated_time: ts(r.updated_time),
            synced_at: new Date().toISOString(),
          };
        });
      if (payload.length) {
        const { error } = await admin
          .from("meta_ads")
          .upsert(payload, { onConflict: "ad_id" });
        if (error) throw new Error(`upsert ads: ${error.message}`);
      }
      stages.push({ stage: "ads", outcome: "done", rows: payload.length, pages });
    } catch (e) {
      noteGraphError(e);
      stages.push({
        stage: "ads",
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
      });
    }
  }

  // ---- creatives INCREMENTAL + relação ad↔creative ------------------
  if (!stop()) {
    try {
      const [adRows, relRows] = await Promise.all([
        admin
          .from("meta_ads")
          .select("id, ad_id, creative_id, updated_time")
          .eq("ad_account_ref", acc.id),
        admin
          .from("meta_ad_creatives")
          .select("ad_id, creative_id")
          .eq("client_id", clientId),
      ]);
      const ads = (adRows.data ?? []) as Array<{
        id: string;
        ad_id: string;
        creative_id: string | null;
      }>;
      const adRefByMetaId = new Map(ads.map((a) => [a.ad_id, a.id]));
      const currentPairs = ads
        .filter((a) => a.creative_id)
        .map((a) => ({ ad_id: a.ad_id, creative_id: a.creative_id as string }));
      const accountAdIds = new Set(ads.map((a) => a.ad_id));
      const knownPairs = ((relRows.data ?? []) as Array<{
        ad_id: string;
        creative_id: string;
      }>).filter((p) => accountAdIds.has(p.ad_id));

      const referencedIds = [
        ...new Set([
          ...currentPairs.map((p) => p.creative_id),
          ...knownPairs.map((p) => p.creative_id),
        ]),
      ];

      // ---- INCREMENTAL: FULL só p/ creative novo / stale / sem detalhe.
      const { data: existRows } = referencedIds.length
        ? await admin
            .from("meta_creatives")
            .select("creative_id, details_fetched_at")
            .in("creative_id", referencedIds)
        : { data: [] as Array<{ creative_id: string; details_fetched_at: string | null }> };
      const detailsAtById = new Map<string, string | null>(
        ((existRows ?? []) as Array<{
          creative_id: string;
          details_fetched_at: string | null;
        }>).map((r) => [r.creative_id, r.details_fetched_at]),
      );
      const staleBefore = new Date(
        Date.now() - CREATIVE_DETAILS_TTL_HOURS * 3600_000,
      ).toISOString();
      const idsToFetch = referencedIds.filter((id) => {
        if (!detailsAtById.has(id)) return true; // creative novo
        const at = detailsAtById.get(id);
        return at == null || at < staleBefore; // sem detalhe / stale
      });
      const knownSkipped = referencedIds.length - idsToFetch.length;

      const fetchResult = await planCreativeFetch({
        ids: idsToFetch,
        transport: graphCreativeTransport(graph),
      });
      if (fetchResult.tokenRevoked) fatal = "token_revoked";
      if (
        fetchResult.telemetry.error_codes.some(
          (c) => c.code != null && [4, 17, 32, 613, 80000].includes(c.code),
        )
      ) {
        rateLimited = "rate_limited";
      }
      const tel = fetchResult.telemetry;
      const nowIso = new Date().toISOString();

      const creativeRows = [...fetchResult.objects.entries()]
        .map(([id, raw]) =>
          creativeDbRow(
            raw,
            { clientId, adAccountRef: acc.id, adAccountId: acc.ad_account_id },
            {
              detailsFetchedAt: fetchResult.minimalOnlyIds.has(id)
                ? (detailsAtById.get(id) ?? null) // MINIMAL: preserva
                : nowIso, // FULL: marca
            },
          ),
        )
        .filter((r): r is NonNullable<typeof r> => r !== null);

      let upserted = 0;
      let creativeUpsertError: string | null = null;
      if (creativeRows.length) {
        const { error } = await admin
          .from("meta_creatives")
          .upsert(creativeRows, { onConflict: "creative_id" });
        if (error) creativeUpsertError = String(error.message).slice(0, 200);
        else upserted = creativeRows.length;
      }

      stages.push({
        stage: "creatives",
        outcome: creativesStageOutcome({
          attempted: tel.attempted,
          fetched: fetchResult.objects.size,
          minimalOnly: tel.minimal_only,
          failed: tel.failed + (creativeUpsertError != null ? 1 : 0),
          fatal: Boolean(fatal),
        }),
        rows: upserted,
        detail: {
          referenced: referencedIds.length,
          known_skipped: knownSkipped,
          refresh_due: idsToFetch.length,
          attempted: tel.attempted,
          full_fetched: tel.full_fetched,
          minimal_fetched: tel.minimal_fetched,
          failed: tel.failed,
          upserted,
          full_fields_available: tel.full_fields_available,
          minimal_only: tel.minimal_only,
          degraded: tel.degraded,
          error_codes: tel.error_codes,
          failed_ids_sample: tel.failed_ids,
          ...(creativeUpsertError ? { upsert_error: creativeUpsertError } : {}),
        },
      });

      // ---- relação ad↔creative — LOG DE OBSERVAÇÃO (last_seen SEMPRE) ----
      const { data: creativeRefRows } = await admin
        .from("meta_creatives")
        .select("id, creative_id")
        .eq("ad_account_ref", acc.id);
      const creativeRefByMetaId = new Map(
        ((creativeRefRows ?? []) as Array<{ id: string; creative_id: string }>).map(
          (r) => [r.creative_id, r.id],
        ),
      );
      const now = new Date().toISOString();
      const plan = planAdCreativeLinks({
        pairs: currentPairs.map((p) => ({
          adId: p.ad_id,
          creativeId: p.creative_id,
        })),
        adRefByMetaId,
        savedCreativeIds: new Set(creativeRefByMetaId.keys()),
      });
      const relPayload = plan.links.map((l) => ({
        client_id: clientId,
        ad_ref: l.adRef,
        creative_ref: creativeRefByMetaId.get(l.creativeId) as string,
        ad_id: l.adId,
        creative_id: l.creativeId,
        last_seen: now, // first_seen: só no INSERT (default now())
        updated_at: now,
      }));
      let linked = 0;
      let linkError: string | null = null;
      if (relPayload.length) {
        const { error } = await admin
          .from("meta_ad_creatives")
          .upsert(relPayload, {
            onConflict: "ad_id,creative_id",
            ignoreDuplicates: false,
          });
        if (error) linkError = String(error.message).slice(0, 200);
        else linked = relPayload.length;
      }
      stages.push({
        stage: "ad_creatives",
        outcome: linkStageOutcome({
          attempted: plan.attempted,
          linked,
          skipped: plan.skipped,
          fatal: Boolean(fatal) || linkError != null,
        }),
        rows: linked,
        detail: {
          attempted: plan.attempted,
          linked,
          skipped: plan.skipped,
          failed: Math.max(0, plan.attempted - linked - plan.skipped),
          ...(linkError ? { upsert_error: linkError } : {}),
        },
      });
    } catch (e) {
      noteGraphError(e);
      stages.push({
        stage: "creatives",
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
        detail: { error: String((e as Error)?.message ?? "unknown").slice(0, 200) },
      });
    }
  }

  // ---- insights por nível -----------------------------------------
  const levels: InsightLevel[] = ["account", "campaign", "adset", "ad"];
  for (const level of levels) {
    if (stop()) break;

    try {
      const { rows, pages } = await listInsights({
        ...graph,
        adAccountId: acc.ad_account_id,
        level,
        timeRange: { since: range.from, until: range.to },
        timeIncrement: "1",
      });
      const daily = toDailyRows(rows, ctxFor(level)).map((d) => ({ ...d }));
      if (daily.length) {
        const { error } = await admin.from("meta_insights_daily").upsert(daily, {
          onConflict: "level,entity_id,date,attribution_window",
        });
        if (error) throw new Error(`upsert daily ${level}: ${error.message}`);
      }
      stages.push({
        stage: `insights_daily_${level}`,
        outcome: "done",
        rows: daily.length,
        pages,
      });
    } catch (e) {
      noteGraphError(e);
      stages.push({
        stage: `insights_daily_${level}`,
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
      });
    }
    if (stop()) break;

    try {
      const periodic: unknown[] = [];
      let pages = 0;
      let anyPreset = false;
      for (const preset of PERIODIC_PRESETS) {
        const fb = presetRange(preset, today);
        try {
          const res = await listInsights({
            ...graph,
            adAccountId: acc.ad_account_id,
            level,
            datePreset: preset,
          });
          pages += res.pages;
          anyPreset = true;
          periodic.push(
            ...toPeriodicRows(res.rows, ctxFor(level), preset, fb.from, fb.to),
          );
        } catch (pe) {
          if (pe instanceof GraphApiError && pe.kind === "token_revoked") {
            fatal = "token_revoked";
            throw pe;
          }
          if (pe instanceof GraphApiError && pe.kind === "rate_limited") {
            rateLimited = "rate_limited";
            throw pe;
          }
          // preset isolado falhou -> segue os outros
        }
      }
      let written = 0;
      if (periodic.length) {
        const { data: n, error } = await admin.rpc("meta_upsert_insights_periodic", {
          p_client_id: clientId,
          p_ad_account_ref: acc.id,
          p_rows: periodic,
        });
        if (error) throw new Error(`upsert periodic ${level}: ${error.message}`);
        written = typeof n === "number" ? n : periodic.length;
      }
      stages.push({
        stage: `insights_periodic_${level}`,
        outcome: anyPreset ? "done" : "error",
        rows: written,
        pages,
      });
    } catch (e) {
      noteGraphError(e);
      stages.push({
        stage: `insights_periodic_${level}`,
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
      });
    }
  }

  // ---- fechamento ------------------------------------------------
  const done = stages.filter((s2) => s2.outcome === "done");
  const degraded = stages.filter((s2) => s2.outcome === "degraded");
  const bad = stages.filter(
    (s2) => s2.outcome !== "done" && s2.outcome !== "degraded",
  );
  const anyNotDone = degraded.length > 0 || bad.length > 0 || rateLimited !== null;
  const status: SyncAccountResult["status"] = fatal
    ? "error"
    : done.length === 0
      ? "error"
      : anyNotDone
        ? "partial"
        : "success";

  const stageDetail = (name: string) =>
    stages.find((s2) => s2.stage === name)?.detail ?? null;

  const stats = {
    status,
    campaigns: done.filter((s2) => s2.stage === "campaigns").reduce((n, s2) => n + (s2.rows ?? 0), 0),
    adsets: done.filter((s2) => s2.stage === "adsets").reduce((n, s2) => n + (s2.rows ?? 0), 0),
    ads: done.filter((s2) => s2.stage === "ads").reduce((n, s2) => n + (s2.rows ?? 0), 0),
    insights_daily: done.filter((s2) => s2.stage.startsWith("insights_daily_")).reduce((n, s2) => n + (s2.rows ?? 0), 0),
    insights_periodic: done.filter((s2) => s2.stage.startsWith("insights_periodic_")).reduce((n, s2) => n + (s2.rows ?? 0), 0),
    creatives: stageDetail("creatives"),
    ad_creatives: stageDetail("ad_creatives"),
    rate_usage: getRateUsage(),
    ...(rateLimited ? { rate_limited: true } : {}),
    stages_done: done.map((s2) => s2.stage),
    stages_degraded: degraded.map((s2) => s2.stage),
    stages_bad: bad.map((s2) => s2.stage),
    pages: stages.reduce((n, s2) => n + (s2.pages ?? 0), 0),
  };

  if (fatal === "token_revoked") {
    await admin.from("meta_connections").update({
      status: "reauthorization_required",
      status_reason: "token_revoked",
      last_error: "token_revoked",
      last_verified_at: new Date().toISOString(),
    }).eq("id", connectionId);
  }

  const errCodes = (stats.creatives as { error_codes?: Array<{ code: number | null }> } | null)
    ?.error_codes?.map((c) => c.code).filter((c): c is number => c != null) ?? [];
  const incompleteStages = [...degraded, ...bad].map((x) => x.stage);
  const runError =
    fatal ??
    rateLimited ??
    (incompleteStages.length
      ? `stages incompletas: ${incompleteStages.join(", ")}` +
        (errCodes.length ? ` (meta code: ${[...new Set(errCodes)].join("/")})` : "")
      : null);

  await admin.rpc("meta_sync_release", {
    p_run_id: runId,
    p_status: status,
    p_stats: stats,
    p_error: runError,
  });
  await admin.from("meta_ad_accounts").update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: status,
    last_sync_error: fatal ?? rateLimited ?? null,
  }).eq("id", acc.id);

  return { status, stats, fatal: fatal ?? rateLimited, range };
}
