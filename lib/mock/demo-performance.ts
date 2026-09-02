import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import type { AdAccount, Campaign, DailyMetric } from "@/types/domain";
import { getMockDataset } from "./dataset";

/**
 * TEMPORÁRIO — dados de performance MOCKADOS.
 *
 * Não são vinculados a nenhum cliente real (nem por id, nem por nome): usam
 * um perfil demo fixo e opaco. Serão substituídos pela integração com a Meta
 * Ads. Enquanto isso, a UI exibe um aviso de "dados demonstrativos".
 */

/** Perfil demo interno usado como base da performance mockada. */
const DEMO_PROFILE_ID = "boutique-rotattiva";

export const DEMO_RESULT_METRIC = RESULT_METRIC_PRESETS.custom;

export interface DemoPerformance {
  accounts: AdAccount[];
  campaigns: Campaign[];
  dailyMetrics: DailyMetric[];
}

export function getDemoPerformance(): DemoPerformance {
  const ds = getMockDataset();
  return {
    accounts: ds.accounts.filter((a) => a.clientId === DEMO_PROFILE_ID),
    campaigns: ds.campaigns.filter((c) => c.clientId === DEMO_PROFILE_ID),
    dailyMetrics: ds.dailyMetrics.filter((m) => m.clientId === DEMO_PROFILE_ID),
  };
}
