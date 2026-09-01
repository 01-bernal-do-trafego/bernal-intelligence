/**
 * Modelo de domínio do Bernal Intelligence.
 * Nesta fase alimentado por dados mockados (lib/mock), mas os tipos já
 * refletem o formato que a integração real com Meta Ads deverá entregar.
 */

export type ClientStatus = "onboarding" | "active" | "paused" | "archived";

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  active: "Ativo",
  paused: "Pausado",
  archived: "Arquivado",
};

export type MetaConnectionStatus = "connected" | "not_connected" | "error";

export const META_STATUS_LABEL: Record<MetaConnectionStatus, string> = {
  connected: "Conectado",
  not_connected: "Não conectado",
  error: "Erro de conexão",
};

export interface Client {
  id: string;
  /** Nome público / comercial. */
  name: string;
  /** Nome interno usado pela equipe Bernal. */
  internalName: string;
  status: ClientStatus;
  metaStatus: MetaConnectionStatus;
  /** Health score mockado (0–100). */
  healthScore: number;
  createdAt: string;
  logoUrl: string | null;
}

export interface AdAccount {
  id: string;
  clientId: string;
  name: string;
  /** Identificador externo (ex.: `act_123456789`). */
  externalId: string;
}

export type CampaignStatus = "active" | "paused" | "ended";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  active: "Ativa",
  paused: "Pausada",
  ended: "Encerrada",
};

export type CampaignObjective = "conversions" | "traffic" | "reach" | "leads";

export interface Campaign {
  id: string;
  accountId: string;
  clientId: string;
  name: string;
  status: CampaignStatus;
  objective: CampaignObjective;
}

export interface DailyMetric {
  date: string;
  clientId: string;
  accountId: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  reach: number;
}

/** Ponto de série temporal genérico para gráficos. */
export interface TimePoint {
  date: string;
  value: number;
}

export type PortfolioAlertKind = "critical" | "warning" | "opportunity";

export interface PortfolioAlert {
  id: string;
  kind: PortfolioAlertKind;
  title: string;
  description: string;
  clientName: string;
}
