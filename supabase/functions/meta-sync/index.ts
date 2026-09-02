/**
 * Edge Function: meta-sync
 * ---------------------------------------------------------------------------
 * META 5 — primeira sincronização de dados REAIS de um cliente.
 *
 * Chamada pelo servidor Next (server action), server-to-server, com
 * `Authorization: Bearer <access_token do usuário Supabase>`. Nunca pelo browser.
 *
 *   POST { clientId }
 *     -> para CADA conta vinculada (is_linked) do cliente:
 *        acquire (trava de concorrência) -> estrutura (campaigns/adsets/ads)
 *        -> insights diários (time_increment=1) e agregados (sem time_increment)
 *        nos níveis account/campaign/adset/ad, últimos 30 dias -> release.
 *
 * Ordem de privilégio: valida JWT -> agência -> can_access_client -> só então
 * lê segredos e descriptografa o token (em memória). Token/App Secret NUNCA
 * retornados nem logados. Não sincroniza criativos nesta etapa.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolvePublishableKey, resolveSecretKey } from "../_shared/supabase.ts";
import { openToken } from "../_shared/crypto.ts";
import {
  GraphApiError,
  GraphPaginationOverflow,
  listEdge,
  listInsights,
} from "../_shared/graph.ts";
import {
  toDailyRows,
  toPeriodicRows,
  type InsightLevel,
} from "../_shared/insights.ts";

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";
// Não forçamos janela de atribuição: a Insights API (desde 10/06/2025) já
// retorna actions/action_values na configuração UNIFICADA de cada conjunto de
// anúncios, espelhando o Ads Manager. `use_unified_attribution_setting` e
// `action_report_time` são desconsiderados — não os passamos. O identificador
// abaixo apenas registra essa semântica na linha.
const ATTR_WINDOW = "unified_attribution";

// Agregados de período: um por preset. A unicidade em meta_insights_periodic é
// o INTERVALO (date_from,date_to) — o preset é só rótulo. Assim reach/frequency
// ficam disponíveis para qualquer preset do dashboard, sem somar diário.
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

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const CAMPAIGN_FIELDS =
  "id,account_id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,start_time,stop_time";
const ADSET_FIELDS =
  "id,campaign_id,account_id,name,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,promoted_object,created_time,updated_time";
const AD_FIELDS =
  "id,adset_id,campaign_id,account_id,name,status,effective_status,creative{id},created_time,updated_time";

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
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

/** "Hoje" no fuso IANA da conta (a Meta reporta insights no fuso da conta). */
function accountToday(timezoneName: string | null): string {
  const tz = timezoneName || "UTC";
  try {
    // en-CA => "YYYY-MM-DD"
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return isoDate(new Date());
  }
}

/**
 * Fallback do intervalo de um preset, com a SEMÂNTICA DA META (last_Nd sem
 * hoje; this_month 1º->hoje; last_month mês anterior). Só usado se a resposta
 * agregada não trouxer date_start/date_stop — o valor autoritativo é o da Meta.
 */
/**
 * Intervalo MÍNIMO da série diária para cobrir TODOS os presets sem buracos:
 *   until = hoje (fuso da conta)
 *   since = menor entre (hoje - 30) e (1º do mês anterior)
 */
function dailyHorizon(today: string): { from: string; to: string } {
  const minus30 = addDays(today, -30);
  const [yy, mm] = today.split("-").map(Number);
  const py = mm === 1 ? yy - 1 : yy;
  const pm = mm === 1 ? 12 : mm - 1;
  const prevMonth = `${py}-${String(pm).padStart(2, "0")}-01`;
  return { from: minus30 < prevMonth ? minus30 : prevMonth, to: today };
}

function presetRange(preset: PeriodicPreset, today: string): { from: string; to: string } {
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let SUPABASE_URL: string;
  let PUBLISHABLE_KEY: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    PUBLISHABLE_KEY = resolvePublishableKey();
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { clientId?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return json({ error: "bad_request" }, 400);

  const { data: profile } = await userClient
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== "agency_admin" && role !== "agency_member") {
    return json({ error: "forbidden" }, 403);
  }
  const { data: client } = await userClient
    .from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return json({ error: "forbidden" }, 403);

  // -- segredos + client administrativo --
  let SECRET_KEY: string;
  let ENC_KEY: string;
  try {
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }
  const admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // conexão corrente
  const { data: conn } = await admin
    .from("meta_connections")
    .select("id, has_secret")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const connection = conn as { id: string; has_secret: boolean } | null;
  if (!connection) return json({ error: "not_connected" }, 409);
  if (!connection.has_secret) return json({ error: "no_connection_secret" }, 409);

  // contas vinculadas
  const { data: accts } = await admin
    .from("meta_ad_accounts")
    .select("id, ad_account_id, currency, timezone_name")
    .eq("client_id", clientId)
    .eq("is_linked", true);
  const accounts = (accts ?? []) as Array<{
    id: string;
    ad_account_id: string;
    currency: string | null;
    timezone_name: string | null;
  }>;
  if (accounts.length === 0) return json({ error: "no_linked_account" }, 409);

  // token (em memória)
  const { data: secret } = await admin
    .from("meta_connection_secrets")
    .select("token_cipher, token_iv, token_tag")
    .eq("connection_id", connection.id)
    .maybeSingle();
  const sec = secret as
    | { token_cipher: string; token_iv: string; token_tag: string }
    | null;
  if (!sec) return json({ error: "no_connection_secret" }, 409);

  let token: string;
  try {
    token = await openToken(
      { cipher: sec.token_cipher, iv: sec.token_iv, tag: sec.token_tag },
      ENC_KEY,
    );
  } catch {
    return json({ error: "decrypt_failed" }, 500);
  }

  // NOTA: a sincronização NÃO lê dashboard_configs. `results` é config-driven e
  // resolvido em leitura (ver lib/meta/result-metric-resolve.ts). O sync só
  // grava métricas canônicas da Meta (leads/conversations/purchases/revenue…).

  const graph = { graphBase: GRAPH_BASE, version: GRAPH_VERSION, token };
  const results: Array<Record<string, unknown>> = [];
  let envelopeRange = dailyHorizon(accountToday(null));

  for (const acc of accounts) {
    const today = accountToday(acc.timezone_name);
    // série diária: horizonte que cobre todos os presets (sem buracos).
    const range = dailyHorizon(today);
    envelopeRange = range;

    // ---- acquire (trava de concorrência) --------------------------------
    let runId: string;
    try {
      const { data: rid, error } = await admin.rpc("meta_sync_acquire", {
        p_client_id: clientId,
        p_connection_id: connection.id,
        p_ad_account_ref: acc.id,
        p_trigger: "manual",
        p_date_from: range.from,
        p_date_to: range.to,
        p_created_by: user.id,
      });
      if (error) {
        if ((error.message ?? "").includes("sync_already_running")) {
          results.push({ adAccountId: acc.ad_account_id, error: "sync_already_running" });
          continue;
        }
        results.push({ adAccountId: acc.ad_account_id, error: "acquire_failed" });
        continue;
      }
      runId = rid as string;
    } catch {
      results.push({ adAccountId: acc.ad_account_id, error: "acquire_failed" });
      continue;
    }

    const stages: Array<{ stage: string; outcome: string; rows?: number; pages?: number }> = [];
    let fatal: string | null = null;

    const ctxFor = (level: InsightLevel) => ({
      clientId,
      adAccountRef: acc.id,
      adAccountId: acc.ad_account_id,
      level,
      attributionWindow: ATTR_WINDOW,
      currency: acc.currency,
    });

    // ---- estrutura -----------------------------------------------------
    // campanhas
    let campaignRefByMetaId = new Map<string, string>();
    let adsetRefByMetaId = new Map<string, string>();
    try {
      const { rows, pages } = await listEdge({
        ...graph,
        path: `${acc.ad_account_id}/campaigns`,
        fields: CAMPAIGN_FIELDS,
      });
      const payload = rows
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).id === "string")
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
      if (e instanceof GraphApiError && e.kind === "token_revoked") fatal = "token_revoked";
      stages.push({
        stage: "campaigns",
        outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
      });
    }

    if (!fatal) {
      const { data: crows } = await admin
        .from("meta_campaigns").select("id, campaign_id").eq("ad_account_ref", acc.id);
      campaignRefByMetaId = new Map(
        ((crows ?? []) as Array<{ id: string; campaign_id: string }>).map((r) => [r.campaign_id, r.id]),
      );
    }

    // adsets
    if (!fatal) {
      try {
        const { rows, pages } = await listEdge({
          ...graph,
          path: `${acc.ad_account_id}/adsets`,
          fields: ADSET_FIELDS,
        });
        const payload = rows
          .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).id === "string")
          .map((r) => ({
            client_id: clientId,
            ad_account_ref: acc.id,
            campaign_ref: s(r.campaign_id) ? campaignRefByMetaId.get(r.campaign_id as string) ?? null : null,
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
        if (e instanceof GraphApiError && e.kind === "token_revoked") fatal = "token_revoked";
        stages.push({
          stage: "adsets",
          outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
        });
      }
    }

    if (!fatal) {
      const { data: arows } = await admin
        .from("meta_adsets").select("id, adset_id").eq("ad_account_ref", acc.id);
      adsetRefByMetaId = new Map(
        ((arows ?? []) as Array<{ id: string; adset_id: string }>).map((r) => [r.adset_id, r.id]),
      );
    }

    // ads
    if (!fatal) {
      try {
        const { rows, pages } = await listEdge({
          ...graph,
          path: `${acc.ad_account_id}/ads`,
          fields: AD_FIELDS,
        });
        const payload = rows
          .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).id === "string")
          .map((r) => {
            const creative = typeof r.creative === "object" && r.creative !== null
              ? (r.creative as Record<string, unknown>)
              : null;
            return {
              client_id: clientId,
              ad_account_ref: acc.id,
              campaign_ref: s(r.campaign_id) ? campaignRefByMetaId.get(r.campaign_id as string) ?? null : null,
              adset_ref: s(r.adset_id) ? adsetRefByMetaId.get(r.adset_id as string) ?? null : null,
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
        if (e instanceof GraphApiError && e.kind === "token_revoked") fatal = "token_revoked";
        stages.push({
          stage: "ads",
          outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
        });
      }
    }

    // ---- insights por nível -----------------------------------------
    const levels: InsightLevel[] = ["account", "campaign", "adset", "ad"];
    for (const level of levels) {
      if (fatal) break;

      // diário (time_increment=1) -> meta_insights_daily.
      // time_range = horizonte que cobre TODOS os presets.
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
        stages.push({ stage: `insights_daily_${level}`, outcome: "done", rows: daily.length, pages });
      } catch (e) {
        if (e instanceof GraphApiError && e.kind === "token_revoked") fatal = "token_revoked";
        stages.push({
          stage: `insights_daily_${level}`,
          outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
        });
      }
      if (fatal) break;

      // agregado (sem time_increment) -> meta_insights_periodic, UM POR PRESET.
      // A unicidade é o intervalo, então os 7 presets convivem e o dashboard
      // acha reach/frequency de qualquer período sem somar diário.
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
            // preset isolado falhou (rate limit etc.) -> segue os outros
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
        if (e instanceof GraphApiError && e.kind === "token_revoked") fatal = "token_revoked";
        stages.push({
          stage: `insights_periodic_${level}`,
          outcome: e instanceof GraphPaginationOverflow ? "skipped" : "error",
        });
      }
    }

    // ---- fechamento --------------------------------------------------
    const done = stages.filter((s2) => s2.outcome === "done");
    const bad = stages.filter((s2) => s2.outcome !== "done");
    const status = fatal ? "error" : done.length === 0 ? "error" : bad.length ? "partial" : "success";

    const stats = {
      status,
      campaigns: done.filter((s2) => s2.stage === "campaigns").reduce((n, s2) => n + (s2.rows ?? 0), 0),
      adsets: done.filter((s2) => s2.stage === "adsets").reduce((n, s2) => n + (s2.rows ?? 0), 0),
      ads: done.filter((s2) => s2.stage === "ads").reduce((n, s2) => n + (s2.rows ?? 0), 0),
      insights_daily: done.filter((s2) => s2.stage.startsWith("insights_daily_")).reduce((n, s2) => n + (s2.rows ?? 0), 0),
      insights_periodic: done.filter((s2) => s2.stage.startsWith("insights_periodic_")).reduce((n, s2) => n + (s2.rows ?? 0), 0),
      stages_done: done.map((s2) => s2.stage),
      stages_bad: bad.map((s2) => s2.stage),
      pages: stages.reduce((n, s2) => n + (s2.pages ?? 0), 0),
    };

    if (fatal === "token_revoked") {
      await admin.from("meta_connections").update({
        status: "reauthorization_required",
        status_reason: "token_revoked",
        last_error: "token_revoked",
        last_verified_at: new Date().toISOString(),
      }).eq("id", connection.id);
    }

    await admin.rpc("meta_sync_release", {
      p_run_id: runId,
      p_status: status,
      p_stats: stats,
      p_error: fatal ?? (bad.length ? `stages incompletas: ${bad.map((b) => b.stage).join(", ")}` : null),
    });
    await admin.from("meta_ad_accounts").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: fatal ?? null,
    }).eq("id", acc.id);

    results.push({
      adAccountId: acc.ad_account_id,
      runId,
      status,
      stats,
      ...(fatal ? { error: fatal } : {}),
    });
  }

  const anyOk = results.some((r) => r.status === "success" || r.status === "partial");
  return json({
    status: anyOk ? "ok" : "error",
    dateFrom: envelopeRange.from,
    dateTo: envelopeRange.to,
    results,
  });
});
