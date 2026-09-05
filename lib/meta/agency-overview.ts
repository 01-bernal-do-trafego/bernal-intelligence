/**
 * Agregação da Visão Geral (Agency Overview) — módulo PURO.
 *
 * `server/agency-overview.ts` busca as linhas reais (Supabase) em um número
 * FIXO de queries (não 1×cliente) e entrega aqui já reduzidas por conta —
 * este módulo só faz a matemática de agregação, reaproveitando as MESMAS
 * peças usadas no dashboard individual do cliente:
 *   - `conversionTotalsFromRow` (resolve as métricas canônicas de raw_actions)
 *   - `resolveResults` / `resolveCostPerResult` (result_metric config-driven)
 *   - `computeMetric` do Registry (CTR/CPC/CPM sobre TOTAIS, nunca média)
 *
 * Regras centrais (não repetir em outro lugar):
 *   - aditivas (spend/impressions/clicks) somam entre contas/clientes sem
 *     problema de dupla contagem (contas são unidades distintas);
 *   - reach/frequency NUNCA entram aqui — não há dedup de pessoas entre
 *     contas/clientes, e por isso a Agency Overview V1 não os mostra;
 *   - "sem dado" (spend === null) é sempre distinto de "zero real"
 *     (spend === 0) e nunca vira 0 num agregado; clientes sem dado no
 *     período NÃO entram nos agregados/rankings.
 */

import { emptyTotals, computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import { sumRawMaps } from "@/lib/meta/dashboard-conversions";
import {
  canonicalMetricForResult,
  resolveCostPerResult,
  resolveResults,
} from "@/lib/meta/result-metric-resolve";
import { resultMetricTypeLabel } from "@/lib/dashboard-config";
import { todayInOffset } from "@/lib/meta/date-preset";
import { utcOffsetMinutes } from "@/lib/meta/timezone";

/**
 * Fuso da AGÊNCIA (não confundir com o fuso de cada ad account, usado na
 * ingestão/sync — esse continua intocado). "Hoje"/"Ontem"/"Este mês"/"Mês
 * passado" da Agency Overview usam ESTE fuso, para bater com a percepção de
 * quem está olhando o painel em Brasília, e não com UTC.
 */
export const AGENCY_TIMEZONE = "America/Sao_Paulo";

/**
 * "Hoje" da Agency Overview no fuso da agência. Reaproveita `todayInOffset` +
 * `utcOffsetMinutes` (mesma infraestrutura já usada por conta no dashboard
 * individual — `lib/meta/date-preset.ts` / `lib/meta/timezone.ts`), só que
 * com um fuso FIXO em vez do fuso de uma conta específica.
 */
export function agencyToday(now: Date = new Date()): string {
  return todayInOffset(utcOffsetMinutes(AGENCY_TIMEZONE) ?? -180, now);
}

/**
 * Alguma conta usa fuso != AGENCY_TIMEZONE? Quando true, os totais de período
 * dessas contas são best-effort (o range é do calendário da agência; os
 * insights guardam datas no calendário DA CONTA — sem hora, não há
 * equivalência perfeita nas fronteiras). `null`/vazio -> mesmo fuso.
 */
export function hasMixedAgencyTimezones(
  timezoneNames: readonly (string | null | undefined)[],
): boolean {
  return timezoneNames.some((tz) => tz != null && tz !== AGENCY_TIMEZONE);
}
import { metaNeedsAction, type MetaUiState } from "@/lib/meta/connection-state";
import type { PerformanceStatus, LastSyncStatus } from "@/lib/meta/sync-health";
import type { ResultMetricType } from "@/types/domain";

/* ================================================================== */
/* Totais aditivos de UMA conta (ou de UM dia) no período              */
/* ================================================================== */

export interface AccountPeriodInput {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  /** id de action_type Meta -> contagem. */
  rawActions: Record<string, number>;
  /** id de action_type Meta -> valor. */
  rawActionValues: Record<string, number>;
}

export function emptyAccountPeriod(): AccountPeriodInput {
  return { spend: null, impressions: null, clicks: null, rawActions: {}, rawActionValues: {} };
}

/**
 * Combina N contas (ou N dias da mesma conta) em 1 total — soma aditiva por
 * campo; `null` só quando TODAS as entradas daquele campo forem `null`
 * (nunca confunde "ninguém tinha dado" com "zero real").
 */
export function combineAccountPeriods(
  accounts: readonly AccountPeriodInput[],
): AccountPeriodInput {
  const add = (a: number | null, b: number | null): number | null =>
    a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  return accounts.reduce<AccountPeriodInput>(
    (acc, a) => ({
      spend: add(acc.spend, a.spend),
      impressions: add(acc.impressions, a.impressions),
      clicks: add(acc.clicks, a.clicks),
      rawActions: sumRawMaps([acc.rawActions, a.rawActions]),
      rawActionValues: sumRawMaps([acc.rawActionValues, a.rawActionValues]),
    }),
    emptyAccountPeriod(),
  );
}

/* ================================================================== */
/* Agregado por CLIENTE                                                */
/* ================================================================== */

export interface ClientAggregateInput {
  clientId: string;
  name: string;
  resultType: ResultMetricType;
  /** já combinado entre as contas elegíveis do cliente (combineAccountPeriods). */
  period: AccountPeriodInput;
}

export interface ClientAggregate {
  clientId: string;
  name: string;
  resultType: ResultMetricType;
  resultLabel: string;
  /** métrica canônica (Registry) que representa o resultado, ou null (results/custom). */
  canonicalResultId: string | null;
  /** havia QUALQUER dado sincronizado no período (spend não nulo)? */
  hasData: boolean;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  results: number | null;
  costPerResult: number | null;
}

export function buildClientAggregate(input: ClientAggregateInput): ClientAggregate {
  const { period, resultType } = input;
  const canonicalResultId = canonicalMetricForResult(resultType);
  const hasData = period.spend !== null;

  const totals: MetricTotals = conversionTotalsFromRow({
    spend: period.spend,
    impressions: period.impressions,
    clicks: period.clicks,
    raw_actions: period.rawActions,
    raw_action_values: period.rawActionValues,
  });

  return {
    clientId: input.clientId,
    name: input.name,
    resultType,
    resultLabel: resultMetricTypeLabel(resultType),
    canonicalResultId,
    hasData,
    spend: period.spend,
    impressions: period.impressions,
    clicks: period.clicks,
    ctr: computeMetric("ctr", totals),
    cpc: computeMetric("cpc", totals),
    cpm: computeMetric("cpm", totals),
    // sem dado sincronizado -> nunca reporta 0 disfarçado de resultado real.
    results: hasData ? resolveResults(totals, resultType) : null,
    costPerResult: hasData ? resolveCostPerResult(totals, resultType) : null,
  };
}

/* ================================================================== */
/* Totais da AGÊNCIA (soma entre clientes com dado no período)         */
/* ================================================================== */

export interface AgencyTotals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
}

export function computeAgencyTotals(
  clients: readonly ClientAggregate[],
): AgencyTotals {
  const withData = clients.filter((c) => c.hasData);
  if (withData.length === 0) {
    return { spend: null, impressions: null, clicks: null, ctr: null, cpc: null, cpm: null };
  }
  const spend = withData.reduce((s, c) => s + (c.spend ?? 0), 0);
  const impressions = withData.reduce((s, c) => s + (c.impressions ?? 0), 0);
  const clicks = withData.reduce((s, c) => s + (c.clicks ?? 0), 0);
  const totals: MetricTotals = { ...emptyTotals(), spend, impressions, clicks };
  return {
    spend,
    impressions,
    clicks,
    ctr: computeMetric("ctr", totals),
    cpc: computeMetric("cpc", totals),
    cpm: computeMetric("cpm", totals),
  };
}

/**
 * Cobertura de dado no período — quantos dos clientes considerados têm dado
 * (`hasData`) vs. o total. Não substitui "sem dado" por 0 em lugar nenhum;
 * serve só para a UI avisar quando um total é uma soma PARCIAL ("6 de 10
 * clientes com dados"), nunca apresentando cobertura parcial como completa
 * silenciosamente.
 */
export interface DataCoverage {
  withData: number;
  total: number;
}

export function computeCoverage(clients: readonly ClientAggregate[]): DataCoverage {
  return { withData: clients.filter((c) => c.hasData).length, total: clients.length };
}

/* ================================================================== */
/* Resultados AGRUPADOS por tipo (nunca somar tipos diferentes)        */
/* ================================================================== */

export interface ResultGroup {
  /** métrica canônica do Registry — identidade do grupo. */
  canonicalId: string;
  label: string;
  spend: number;
  results: number;
  /** SUM(spend)/SUM(results) do grupo — NUNCA média dos cost_per_result individuais. */
  costPerResult: number | null;
  /** clientes com DADO no período (somados acima). */
  clientCount: number;
  /**
   * TODOS os clientes configurados com esse tipo canônico, com ou sem dado no
   * período — para a UI avisar cobertura parcial ("2 de 3 clientes com
   * dados") sem transformar ausência em zero.
   */
  totalConfiguredCount: number;
}

/**
 * Agrupa clientes pelo `result_metric` CANÔNICO configurado. Um cliente com
 * dado real mas ZERO eventos no período contribui 0 aos `results` do grupo
 * (soma correta), mas seu `spend` real ainda entra — nunca se perde
 * investimento na soma. `results`/`custom` (sem canônica) nunca entram, com
 * ou sem dado. Um grupo só aparece se PELO MENOS 1 cliente tiver dado —
 * senão os números seriam um "0" inventado, não uma soma real.
 */
export function groupResultsByType(
  clients: readonly ClientAggregate[],
): ResultGroup[] {
  const groups = new Map<
    string,
    {
      spend: number;
      results: number;
      clientCount: number;
      totalConfiguredCount: number;
      label: string;
    }
  >();
  for (const c of clients) {
    if (c.canonicalResultId === null) continue;
    const g = groups.get(c.canonicalResultId) ?? {
      spend: 0,
      results: 0,
      clientCount: 0,
      totalConfiguredCount: 0,
      label: resultMetricTypeLabel(c.canonicalResultId as ResultMetricType),
    };
    g.totalConfiguredCount += 1;
    if (c.hasData) {
      g.spend += c.spend ?? 0;
      g.results += c.results ?? 0;
      g.clientCount += 1;
    }
    groups.set(c.canonicalResultId, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.clientCount > 0)
    .map(([canonicalId, g]) => ({
      canonicalId,
      label: g.label,
      spend: g.spend,
      results: g.results,
      costPerResult: g.results > 0 ? g.spend / g.results : null,
      clientCount: g.clientCount,
      totalConfiguredCount: g.totalConfiguredCount,
    }))
    .sort((a, b) => b.results - a.results);
}

/* ================================================================== */
/* Top clientes por investimento                                       */
/* ================================================================== */

export interface TopClientBySpend {
  clientId: string;
  name: string;
  spend: number;
}

export function topClientsBySpend(
  clients: readonly ClientAggregate[],
  limit = 10,
): TopClientBySpend[] {
  return clients
    .filter((c) => c.hasData && (c.spend ?? 0) > 0)
    .map((c) => ({ clientId: c.clientId, name: c.name, spend: c.spend ?? 0 }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);
}

/* ================================================================== */
/* Série diária de investimento (agência inteira)                      */
/* ================================================================== */

export interface DailySpendInput {
  date: string;
  spend: number | null;
}

/** Soma o spend de todas as contas/clientes por dia — só métrica aditiva. */
export function aggregateDailySpend(
  rows: readonly DailySpendInput[],
): { date: string; value: number }[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (r.spend == null) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.spend);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/* ================================================================== */
/* Saúde da operação (contagens — usa meta_client_sync_health real)     */
/* ================================================================== */

export interface HealthRowInput {
  performanceStatus: PerformanceStatus;
  lastSyncStatus: LastSyncStatus;
  metaState: MetaUiState;
}

export interface HealthCounts {
  fresh: number;
  stale: number;
  never: number;
  /** last_sync_status = failed | partial. */
  lastSyncProblem: number;
  /** Meta não conectada, expirada, revogada ou pedindo reconexão. */
  metaNeedsAttention: number;
  /** clientes distintos com QUALQUER um dos problemas acima. */
  attentionCount: number;
}

export function summarizeHealth(rows: readonly HealthRowInput[]): HealthCounts {
  let fresh = 0;
  let stale = 0;
  let never = 0;
  let lastSyncProblem = 0;
  let metaNeedsAttention = 0;
  let attentionCount = 0;
  for (const r of rows) {
    if (r.performanceStatus === "fresh") fresh += 1;
    else if (r.performanceStatus === "stale") stale += 1;
    else never += 1;

    const syncProblem = r.lastSyncStatus === "failed" || r.lastSyncStatus === "partial";
    if (syncProblem) lastSyncProblem += 1;

    const needsAttentionMeta = metaNeedsAction(r.metaState);
    if (needsAttentionMeta) metaNeedsAttention += 1;

    if (r.performanceStatus !== "fresh" || syncProblem || needsAttentionMeta) {
      attentionCount += 1;
    }
  }
  return { fresh, stale, never, lastSyncProblem, metaNeedsAttention, attentionCount };
}
