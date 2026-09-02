/**
 * Normalização de insights (Edge Function / Deno). Espelha a fatia base de
 * `lib/meta/sync-insights.ts` + `lib/meta/normalizer.ts` do app (a versão do
 * app é a testada). Métricas base (spend/impressions/reach/clicks/
 * inline_link_clicks/frequency) + CONVERSÕES (actions/action_values resolvidos
 * por prioridade + crus para auditoria — ver `./actions.ts`).
 *
 * Ausência de campo => null (nunca 0). Devolve linhas já no formato snake_case
 * das tabelas meta_insights_daily / meta_insights_periodic.
 */

import { normalizeActions } from "./actions.ts";

export type InsightLevel = "account" | "campaign" | "adset" | "ad";

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 10) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function entityId(
  raw: Record<string, unknown>,
  level: InsightLevel,
  adAccountId: string,
): string {
  switch (level) {
    case "account":
      return typeof raw.account_id === "string" ? `act_${raw.account_id}` : adAccountId;
    case "campaign":
      return str(raw.campaign_id) ?? "";
    case "adset":
      return str(raw.adset_id) ?? "";
    case "ad":
      return str(raw.ad_id) ?? "";
  }
}

export interface DbInsightRow {
  client_id: string;
  ad_account_ref: string;
  level: InsightLevel;
  entity_id: string;
  ad_account_id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  attribution_window: string;
  currency: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  frequency: number | null;
  actions: Record<string, number>;
  action_values: Record<string, number>;
  raw_actions: Record<string, number>;
  raw_action_values: Record<string, number>;
}

export interface DailyInsightRow extends DbInsightRow {
  date: string;
}
export interface PeriodicInsightRow extends DbInsightRow {
  period_key: string;
  date_from: string;
  date_to: string;
}

interface Ctx {
  clientId: string;
  adAccountRef: string;
  adAccountId: string; // act_123
  level: InsightLevel;
  attributionWindow: string;
  currency: string | null;
  /** tipo de result_metric do cliente (define a fonte de `actions.results`). */
  resultMetricType?: string | null;
}

function baseRow(raw: Record<string, unknown>, ctx: Ctx): DbInsightRow | null {
  const eid = entityId(raw, ctx.level, ctx.adAccountId);
  if (!eid) return null;
  const conv = normalizeActions(raw.actions, raw.action_values, ctx.resultMetricType);
  return {
    client_id: ctx.clientId,
    ad_account_ref: ctx.adAccountRef,
    level: ctx.level,
    entity_id: eid,
    ad_account_id: ctx.adAccountId,
    campaign_id: str(raw.campaign_id),
    adset_id: str(raw.adset_id),
    ad_id: str(raw.ad_id),
    attribution_window: ctx.attributionWindow,
    currency: ctx.currency,
    spend: numOrNull(raw.spend),
    impressions: intOrNull(raw.impressions),
    reach: intOrNull(raw.reach),
    clicks: intOrNull(raw.clicks),
    inline_link_clicks: intOrNull(raw.inline_link_clicks),
    frequency: numOrNull(raw.frequency),
    actions: conv.actions,
    action_values: conv.action_values,
    raw_actions: conv.raw_actions,
    raw_action_values: conv.raw_action_values,
  };
}

export function toDailyRows(rows: unknown[], ctx: Ctx): DailyInsightRow[] {
  const out: DailyInsightRow[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const raw = r as Record<string, unknown>;
    const date = isoDate(raw.date_start);
    if (!date) continue;
    const base = baseRow(raw, ctx);
    if (!base) continue;
    out.push({ ...base, date });
  }
  return out;
}

/**
 * Linhas agregadas -> meta_insights_periodic. A unicidade é o INTERVALO
 * (date_from, date_to): cada sincronização grava o seu, então `last_30d` de
 * dias diferentes convivem. `period_key` é só rótulo. `date_from`/`date_to`
 * vêm da própria Meta (`date_start`/`date_stop`); o fallback só entra se a
 * resposta os omitir. Linha com intervalo inválido (from > to) é descartada.
 */
export function toPeriodicRows(
  rows: unknown[],
  ctx: Ctx,
  periodKey: string,
  fallbackFrom: string,
  fallbackTo: string,
): PeriodicInsightRow[] {
  const out: PeriodicInsightRow[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const raw = r as Record<string, unknown>;
    const base = baseRow(raw, ctx);
    if (!base) continue;
    const dateFrom = isoDate(raw.date_start) ?? fallbackFrom;
    const dateTo = isoDate(raw.date_stop) ?? fallbackTo;
    if (!dateFrom || !dateTo || dateFrom > dateTo) continue;
    out.push({ ...base, period_key: periodKey, date_from: dateFrom, date_to: dateTo });
  }
  return out;
}
