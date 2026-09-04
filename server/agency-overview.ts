import "server-only";

import type { PeriodPreset } from "@/lib/date-range";
import { metaPresetRange } from "@/lib/meta/date-preset";
import { META_ATTRIBUTION_QUERY_VALUES } from "@/lib/meta/config";
import { parseDashboardConfig } from "@/lib/dashboard-config";
import type { MetaUiState } from "@/lib/meta/connection-state";
import {
  aggregateClientMetaState,
  type ClientAccountLinkInfo,
  type ClientConnectionInfo,
} from "@/lib/meta/agency-meta-status";
import type {
  PerformanceStatus,
  LastSyncStatus,
  CreativesStatus,
} from "@/lib/meta/sync-health";
import {
  agencyToday,
  buildClientAggregate,
  combineAccountPeriods,
  computeAgencyTotals,
  computeCoverage,
  emptyAccountPeriod,
  groupResultsByType,
  summarizeHealth,
  topClientsBySpend,
  aggregateDailySpend,
  type AccountPeriodInput,
  type AgencyTotals,
  type ClientAggregate,
  type DataCoverage,
  type ResultGroup,
  type TopClientBySpend,
  type HealthCounts,
} from "@/lib/meta/agency-overview";
import { createSupabaseServerClient } from "@/supabase/server";
import type { ResultMetricType } from "@/types/domain";

const ATTR_VALUES = META_ATTRIBUTION_QUERY_VALUES;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const asRawMap = (v: unknown): Record<string, number> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .map(([k, val]) => [k, num(val)] as const)
          .filter((e): e is [string, number] => e[1] !== null),
      )
    : {};

export interface AgencyOverviewClientRow {
  clientId: string;
  name: string;
  metaState: MetaUiState;
  linkedAccountCount: number;
  aggregate: ClientAggregate;
  performanceStatus: PerformanceStatus;
  performanceSyncedAt: string | null;
  creativesStatus: CreativesStatus;
  lastSyncAt: string | null;
  lastSyncStatus: LastSyncStatus;
}

export interface AgencyOverview {
  preset: PeriodPreset;
  range: { start: string; end: string };
  /** falso só se a query base de clientes falhou (erro de infraestrutura). */
  ok: boolean;
  activeClientsCount: number;
  clientsWithMetaConnectedCount: number;
  linkedAccountsCount: number;
  linkedAccountsClientCount: number;
  totals: AgencyTotals;
  resultGroups: ResultGroup[];
  health: HealthCounts;
  dailySpendSeries: { date: string; value: number }[];
  topClientsBySpend: TopClientBySpend[];
  clients: AgencyOverviewClientRow[];
  /** performance_synced_at mais recente entre os clientes — para o header. */
  lastUpdatedAt: string | null;
  /** cobertura de dado no período — para nunca apresentar soma parcial como completa. */
  coverage: DataCoverage;
}

function emptyOverview(preset: PeriodPreset, range: { start: string; end: string }, ok: boolean): AgencyOverview {
  return {
    preset,
    range,
    ok,
    activeClientsCount: 0,
    clientsWithMetaConnectedCount: 0,
    linkedAccountsCount: 0,
    linkedAccountsClientCount: 0,
    totals: { spend: null, impressions: null, clicks: null, ctr: null, cpc: null, cpm: null },
    resultGroups: [],
    health: {
      fresh: 0,
      stale: 0,
      never: 0,
      lastSyncProblem: 0,
      metaNeedsAttention: 0,
      attentionCount: 0,
    },
    dailySpendSeries: [],
    topClientsBySpend: [],
    clients: [],
    lastUpdatedAt: null,
    coverage: { withData: 0, total: 0 },
  };
}

/**
 * Visão Geral REAL da agência — SEM mock. Faz um número FIXO de queries
 * (independente de N clientes): clientes ativos, contas vinculadas, conexões
 * Meta, configs de dashboard, saúde de sync (view), agregados periódicos e
 * diários — tudo com `IN (...)`, nunca 1 query por cliente. RLS de sessão
 * (`can_access_client`) se aplica a CADA tabela, mesmo agrupando por IN.
 */
export async function getAgencyOverview(preset: PeriodPreset): Promise<AgencyOverview> {
  // "hoje" no fuso da AGÊNCIA (America/Sao_Paulo) — não no fuso de cada conta
  // (isso não muda) nem em UTC. Ver lib/meta/agency-overview.ts#agencyToday.
  const today = agencyToday();
  const range = metaPresetRange(preset, today);

  try {
    const supabase = await createSupabaseServerClient();

    // 1) clientes ATIVOS (RLS já restringe à agência da sessão).
    const { data: clientsData, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name")
      .eq("status", "active")
      .order("name", { ascending: true });
    if (clientsErr) return emptyOverview(preset, range, false);

    const activeClients = (clientsData ?? []) as { id: string; name: string }[];
    if (activeClients.length === 0) return emptyOverview(preset, range, true);
    const clientIds = activeClients.map((c) => c.id);

    // 2)-5) queries em paralelo, todas por IN (client_id) — sem N+1.
    const [
      { data: accountsData },
      { data: connectionsData },
      { data: configsData },
      { data: healthData },
    ] = await Promise.all([
      supabase
        .from("meta_ad_accounts")
        .select("client_id, ad_account_id, account_name, connection_id")
        .in("client_id", clientIds)
        .eq("is_linked", true),
      supabase
        .from("meta_connections")
        .select("id, client_id, status, has_secret")
        .in("client_id", clientIds),
      supabase
        .from("dashboard_configs")
        .select("client_id, result_metric")
        .in("client_id", clientIds),
      supabase
        .from("meta_client_sync_health")
        .select(
          "client_id, performance_synced_at, performance_status, last_sync_at, last_sync_status, creatives_status",
        )
        .in("client_id", clientIds),
    ]);

    const accounts = (accountsData ?? []) as {
      client_id: string;
      ad_account_id: string;
      connection_id: string | null;
    }[];
    const accountIds = accounts.map((a) => a.ad_account_id);
    const clientAccountIds = new Map<string, string[]>();
    // contas RELEVANTES p/ o estado Meta agregado (is_linked=true + sua connection).
    const accountLinksByClient = new Map<string, ClientAccountLinkInfo[]>();
    for (const a of accounts) {
      const idsList = clientAccountIds.get(a.client_id);
      if (idsList) idsList.push(a.ad_account_id);
      else clientAccountIds.set(a.client_id, [a.ad_account_id]);

      const link: ClientAccountLinkInfo = { connectionId: a.connection_id, isLinked: true };
      const linksList = accountLinksByClient.get(a.client_id);
      if (linksList) linksList.push(link);
      else accountLinksByClient.set(a.client_id, [link]);
    }

    // TODAS as connections do cliente (não só a mais recente) — a agregação
    // de estado descarta as que não são referenciadas por nenhuma conta
    // is_linked=true (órfãs/desvinculadas não podem poluir o status).
    const connectionsByClient = new Map<string, ClientConnectionInfo[]>();
    for (const row of (connectionsData ?? []) as Record<string, unknown>[]) {
      const clientId = str(row.client_id);
      const connectionId = str(row.id);
      if (!clientId || !connectionId) continue;
      const info: ClientConnectionInfo = {
        connectionId,
        status: row.status,
        hasSecret: row.has_secret,
      };
      const list = connectionsByClient.get(clientId);
      if (list) list.push(info);
      else connectionsByClient.set(clientId, [info]);
    }

    const resultTypeByClient = new Map<string, ResultMetricType>();
    for (const row of (configsData ?? []) as Record<string, unknown>[]) {
      const clientId = str(row.client_id);
      if (!clientId) continue;
      const config = parseDashboardConfig({ result_metric: row.result_metric });
      resultTypeByClient.set(clientId, config.resultMetric.type);
    }

    interface HealthRow {
      performanceSyncedAt: string | null;
      performanceStatus: PerformanceStatus;
      lastSyncAt: string | null;
      lastSyncStatus: LastSyncStatus;
      creativesStatus: CreativesStatus;
    }
    const healthByClient = new Map<string, HealthRow>();
    for (const row of (healthData ?? []) as Record<string, unknown>[]) {
      const clientId = str(row.client_id);
      if (!clientId) continue;
      healthByClient.set(clientId, {
        performanceSyncedAt: str(row.performance_synced_at),
        performanceStatus: (str(row.performance_status) ?? "never") as PerformanceStatus,
        lastSyncAt: str(row.last_sync_at),
        lastSyncStatus: (str(row.last_sync_status) ?? "never") as LastSyncStatus,
        creativesStatus: (str(row.creatives_status) ?? "unknown") as CreativesStatus,
      });
    }

    // 6)-7) insights: periódico (autoritativo p/ total do período, por conta)
    // e diário (fallback por conta + fonte ÚNICA do gráfico ao longo do tempo).
    const [{ data: periodicData }, { data: dailyData }] =
      accountIds.length === 0
        ? [{ data: [] }, { data: [] }]
        : await Promise.all([
            supabase
              .from("meta_insights_periodic")
              .select("entity_id, date_to, spend, impressions, clicks, raw_actions, raw_action_values")
              .eq("level", "account")
              .eq("period_key", preset)
              .in("entity_id", accountIds)
              .in("attribution_window", ATTR_VALUES)
              .order("date_to", { ascending: false }),
            supabase
              .from("meta_insights_daily")
              .select("entity_id, date, spend, impressions, clicks, raw_actions, raw_action_values")
              .eq("level", "account")
              .gte("date", range.start)
              .lte("date", range.end)
              .in("entity_id", accountIds)
              .in("attribution_window", ATTR_VALUES),
          ]);

    const toAccountPeriod = (row: Record<string, unknown>): AccountPeriodInput => ({
      spend: num(row.spend),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      rawActions: asRawMap(row.raw_actions),
      rawActionValues: asRawMap(row.raw_action_values),
    });

    // periódico: 1 linha (a mais recente) por conta — autoritativa quando existe.
    const periodicByAccount = new Map<string, AccountPeriodInput>();
    for (const row of (periodicData ?? []) as Record<string, unknown>[]) {
      const entityId = str(row.entity_id);
      if (!entityId || periodicByAccount.has(entityId)) continue;
      periodicByAccount.set(entityId, toAccountPeriod(row));
    }

    // diário: agrupado por conta (fallback) E por data (gráfico agency-wide).
    const dailyByAccount = new Map<string, AccountPeriodInput[]>();
    const dailyForChart: { date: string; spend: number | null }[] = [];
    for (const row of (dailyData ?? []) as Record<string, unknown>[]) {
      const entityId = str(row.entity_id);
      const date = str(row.date);
      const period = toAccountPeriod(row);
      if (entityId) {
        const list = dailyByAccount.get(entityId);
        if (list) list.push(period);
        else dailyByAccount.set(entityId, [period]);
      }
      if (date) dailyForChart.push({ date, spend: period.spend });
    }

    /** total do período de UMA conta: periódico se existir, senão soma do diário. */
    function accountPeriodTotals(adAccountId: string): AccountPeriodInput {
      const periodic = periodicByAccount.get(adAccountId);
      if (periodic) return periodic;
      const daily = dailyByAccount.get(adAccountId);
      return daily ? combineAccountPeriods(daily) : emptyAccountPeriod();
    }

    // ---- agregado por cliente -------------------------------------------
    const clientAggregates: ClientAggregate[] = [];
    const rows: AgencyOverviewClientRow[] = [];
    for (const client of activeClients) {
      const accIds = clientAccountIds.get(client.id) ?? [];
      const period = combineAccountPeriods(accIds.map((id) => accountPeriodTotals(id)));
      const resultType = resultTypeByClient.get(client.id) ?? parseDashboardConfig(null).resultMetric.type;
      const aggregate = buildClientAggregate({
        clientId: client.id,
        name: client.name,
        resultType,
        period,
      });
      clientAggregates.push(aggregate);

      const health = healthByClient.get(client.id);
      const metaState = aggregateClientMetaState(
        connectionsByClient.get(client.id) ?? [],
        accountLinksByClient.get(client.id) ?? [],
      );
      rows.push({
        clientId: client.id,
        name: client.name,
        metaState,
        linkedAccountCount: accIds.length,
        aggregate,
        performanceStatus: health?.performanceStatus ?? "never",
        performanceSyncedAt: health?.performanceSyncedAt ?? null,
        creativesStatus: health?.creativesStatus ?? "unknown",
        lastSyncAt: health?.lastSyncAt ?? null,
        lastSyncStatus: health?.lastSyncStatus ?? "never",
      });
    }

    const health = summarizeHealth(
      rows.map((r) => ({
        performanceStatus: r.performanceStatus,
        lastSyncStatus: r.lastSyncStatus,
        metaState: r.metaState,
      })),
    );

    const lastUpdatedAt = rows.reduce<string | null>((max, r) => {
      if (!r.performanceSyncedAt) return max;
      if (!max || r.performanceSyncedAt > max) return r.performanceSyncedAt;
      return max;
    }, null);

    const clientsWithMetaConnectedCount = rows.filter(
      (r) => r.metaState === "connected" || r.metaState === "expiring",
    ).length;
    const linkedClientIds = new Set(accounts.map((a) => a.client_id));

    return {
      preset,
      range,
      ok: true,
      activeClientsCount: activeClients.length,
      clientsWithMetaConnectedCount,
      linkedAccountsCount: accounts.length,
      linkedAccountsClientCount: linkedClientIds.size,
      totals: computeAgencyTotals(clientAggregates),
      resultGroups: groupResultsByType(clientAggregates),
      health,
      dailySpendSeries: aggregateDailySpend(dailyForChart),
      topClientsBySpend: topClientsBySpend(clientAggregates),
      clients: rows,
      lastUpdatedAt,
      coverage: computeCoverage(clientAggregates),
    };
  } catch {
    return emptyOverview(preset, range, false);
  }
}
