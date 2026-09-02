/**
 * Fonte mock ÚNICA e centralizada: clientes, contas, campanhas e métricas
 * diárias. Nada de números aleatórios espalhados pela UI — tudo sai daqui e
 * é gerado de forma determinística (seed fixa).
 *
 * Os filtros e comparações da aplicação recalculam de verdade sobre estes
 * dados (ver server/*), não trocam números apenas visualmente.
 */

import { addDays, eachDay } from "@/lib/date-range";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import { DEFAULT_SHARE_CONFIG } from "@/types/domain";
import type {
  AdAccount,
  Campaign,
  CampaignObjective,
  Client,
  DailyMetric,
  ResultMetricType,
  SyncState,
} from "@/types/domain";
import { createRng } from "./seed";

/** Âncora temporal dos dados mockados (independe da data real do sistema). */
export const MOCK_TODAY = "2026-09-01";
/** Histórico gerado para trás a partir de MOCK_TODAY. */
export const MOCK_HISTORY_DAYS = 90;

export interface MockDataset {
  clients: Client[];
  accounts: AdAccount[];
  campaigns: Campaign[];
  dailyMetrics: DailyMetric[];
}

/**
 * Definição de um cliente fictício. Cada cliente é independente: tem sua
 * própria métrica principal, contas, campanhas e rótulo de sincronização.
 * Nada aqui é tratado de forma especial pelo resto do sistema.
 */
interface ClientDef {
  id: string;
  name: string;
  internalName: string;
  status: Client["status"];
  metaStatus: Client["metaStatus"];
  healthScore: number;
  createdAt: string;
  accounts: number;
  resultMetric: ResultMetricType;
  lastSyncLabel: string;
  syncState: SyncState;
}

const CLIENT_DEFS: readonly ClientDef[] = [
  {
    id: "uniforte",
    name: "Uniforte",
    internalName: "Uniforte Demo",
    status: "active",
    metaStatus: "connected",
    healthScore: 82,
    createdAt: "2025-11-12",
    accounts: 2,
    resultMetric: "purchases",
    lastSyncLabel: "Agora",
    syncState: "ok",
  },
  {
    id: "boutique-rotattiva",
    name: "Boutique Rotattiva",
    internalName: "Rotattiva",
    status: "active",
    metaStatus: "connected",
    healthScore: 76,
    createdAt: "2026-01-20",
    accounts: 1,
    resultMetric: "purchases",
    lastSyncLabel: "5 min atrás",
    syncState: "ok",
  },
  {
    id: "oversized-store",
    name: "Oversized Store",
    internalName: "Oversized",
    status: "active",
    metaStatus: "connected",
    healthScore: 69,
    createdAt: "2026-02-05",
    accounts: 1,
    resultMetric: "purchases",
    lastSyncLabel: "12 min atrás",
    syncState: "ok",
  },
  {
    id: "atacado-do-chinelo",
    name: "Atacado do Chinelo",
    internalName: "Atacado Chinelo",
    status: "paused",
    metaStatus: "connected",
    healthScore: 48,
    createdAt: "2025-09-30",
    accounts: 1,
    resultMetric: "leads",
    lastSyncLabel: "38 min atrás",
    syncState: "stale",
  },
  {
    id: "clinica-vitalita",
    name: "Clínica Vitalità",
    internalName: "Vitalità",
    status: "onboarding",
    metaStatus: "not_connected",
    healthScore: 0,
    createdAt: "2026-08-18",
    accounts: 0,
    resultMetric: "appointments",
    lastSyncLabel: "—",
    syncState: "never",
  },
  {
    id: "studio-corpo",
    name: "Studio Corpo",
    internalName: "Studio Corpo",
    status: "archived",
    metaStatus: "error",
    healthScore: 31,
    createdAt: "2025-06-11",
    accounts: 1,
    resultMetric: "leads",
    lastSyncLabel: "Erro de sincronização",
    syncState: "error",
  },
];

const ACCOUNT_SUFFIXES = ["Performance", "Institucional", "Principal"] as const;

const CAMPAIGN_NAMES: Record<CampaignObjective, readonly string[]> = {
  conversions: [
    "Conversões · Catálogo",
    "Conversões · Retargeting 7d",
    "Conversões · Lookalike 1%",
    "Conversões · Prospecção fria",
  ],
  traffic: ["Tráfego · Coleção nova", "Tráfego · Blog"],
  reach: ["Alcance · Institucional"],
  leads: ["Leads · Formulário", "Leads · WhatsApp"],
};

const OBJECTIVE_MIX: readonly CampaignObjective[] = [
  "conversions",
  "conversions",
  "traffic",
  "leads",
  "reach",
];

function buildClients(): Client[] {
  return CLIENT_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    internalName: def.internalName,
    status: def.status,
    metaStatus: def.metaStatus,
    healthScore: def.healthScore,
    createdAt: def.createdAt,
    logoUrl: null,
    dashboardConfig: {
      resultMetric: RESULT_METRIC_PRESETS[def.resultMetric],
    },
    shareConfig: { ...DEFAULT_SHARE_CONFIG },
    lastSyncLabel: def.lastSyncLabel,
    syncState: def.syncState,
  }));
}

function buildAccounts(): AdAccount[] {
  const accounts: AdAccount[] = [];
  for (const def of CLIENT_DEFS) {
    for (let i = 0; i < def.accounts; i++) {
      accounts.push({
        id: `${def.id}-acc-${i + 1}`,
        clientId: def.id,
        name: `${def.name} · ${ACCOUNT_SUFFIXES[i] ?? `Conta ${i + 1}`}`,
        externalId: `act_${createRng(`${def.id}-acc-${i}`).int(10_000_000, 99_999_999)}`,
      });
    }
  }
  return accounts;
}

function buildCampaigns(accounts: readonly AdAccount[]): Campaign[] {
  const campaigns: Campaign[] = [];
  for (const account of accounts) {
    const rng = createRng(`${account.id}-campaigns`);
    const count = rng.int(3, 5);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const objective = OBJECTIVE_MIX[i % OBJECTIVE_MIX.length] as CampaignObjective;
      const pool = CAMPAIGN_NAMES[objective];
      let name = pool[i % pool.length] as string;
      if (used.has(name)) name = `${name} ${i + 1}`;
      used.add(name);

      const roll = rng.next();
      const status: Campaign["status"] =
        roll > 0.82 ? "ended" : roll > 0.62 ? "paused" : "active";

      campaigns.push({
        id: `${account.id}-camp-${i + 1}`,
        accountId: account.id,
        clientId: account.clientId,
        name,
        status,
        objective,
      });
    }
  }
  return campaigns;
}

function buildDailyMetrics(campaigns: readonly Campaign[]): DailyMetric[] {
  const start = addDays(MOCK_TODAY, -(MOCK_HISTORY_DAYS - 1));
  const days = eachDay({ start, end: MOCK_TODAY });
  const lastIndex = days.length - 1;

  const rows: DailyMetric[] = [];

  for (const campaign of campaigns) {
    const rng = createRng(`${campaign.id}-metrics`);
    const cpmBase = rng.range(9, 34);
    const ctrBase = rng.range(0.009, 0.026);
    const cvrBase = rng.range(0.03, 0.13);
    const spendBase = rng.range(60, 480);
    const trend = rng.range(-0.25, 0.3);
    const weekendFactor = rng.range(0.6, 0.85);

    days.forEach((date, dayIndex) => {
      const progress = lastIndex === 0 ? 0 : dayIndex / lastIndex;
      const trendFactor = 1 + trend * progress;
      const seasonal = 1 + 0.12 * Math.sin((dayIndex / 7) * Math.PI * 2);
      const noise = rng.range(0.85, 1.15);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const isWeekend = dow === 0 || dow === 6;

      const daysFromEnd = lastIndex - dayIndex;
      let lifecycle = 1;
      if (campaign.status === "ended" && daysFromEnd < 25) lifecycle = 0;
      else if (campaign.status === "paused" && daysFromEnd < 10) lifecycle = 0;
      else if (campaign.status === "paused") lifecycle = 0.45;

      const dayFactor =
        trendFactor * seasonal * noise * (isWeekend ? weekendFactor : 1) * lifecycle;

      const spend = Math.max(0, Number((spendBase * dayFactor).toFixed(2)));
      const impressions = Math.round((spend / cpmBase) * 1000);
      const clicks = Math.round(impressions * ctrBase * rng.range(0.9, 1.1));
      const results = Math.round(clicks * cvrBase * rng.range(0.85, 1.15));
      const reach = Math.round(impressions * rng.range(0.62, 0.8));

      rows.push({
        date,
        clientId: campaign.clientId,
        accountId: campaign.accountId,
        campaignId: campaign.id,
        spend,
        impressions,
        clicks: Math.min(clicks, impressions),
        results: Math.max(0, results),
        reach,
      });
    });
  }

  return rows;
}

let cache: MockDataset | null = null;

export function getMockDataset(): MockDataset {
  if (cache) return cache;
  const clients = buildClients();
  const accounts = buildAccounts();
  const campaigns = buildCampaigns(accounts);
  const dailyMetrics = buildDailyMetrics(campaigns);
  cache = { clients, accounts, campaigns, dailyMetrics };
  return cache;
}
