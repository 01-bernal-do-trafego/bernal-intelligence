/**
 * Modelo de domínio do Bernal Intelligence.
 * Nesta fase a performance ainda é mockada (lib/mock), mas os tipos já
 * refletem o formato que a integração real com Meta Ads deverá entregar.
 */

import type { MetricBehavior } from "@/lib/comparison";

export type { MetricBehavior };

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

/**
 * Tipo da conversão principal de um cliente. O Bernal Intelligence é
 * multicliente: cada cliente define qual conversão é o "resultado" que
 * importa (e, por consequência, o "custo por resultado"). O `type` é um id
 * estável salvo em `dashboard_configs.result_metric`.
 */
export type ResultMetricType =
  | "leads"
  | "purchases"
  | "conversations"
  | "registrations"
  | "appointments"
  | "results"
  | "custom";

export interface ResultMetricConfig {
  type: ResultMetricType;
  /** Nome exibido (plural) para o total, ex.: "Compras". */
  resultLabel: string;
  /** Rótulo do custo por unidade, ex.: "Custo por compra". */
  costLabel: string;
  /** Como classificar a variação da métrica principal. */
  behavior: MetricBehavior;
}

/**
 * Configuração de dashboard por cliente. Nesta V1 só `resultMetric` é usado.
 * Os demais campos ficam registrados para a fase de "Editar dashboard":
 * escolher métricas, cards, gráficos e tabelas, reorganizar componentes,
 * salvar a configuração por cliente e, futuramente, aplicar templates.
 */
export interface DashboardConfig {
  resultMetric: ResultMetricConfig;
  // Futuro (Editar dashboard):
  // visibleKpis?: string[];
  // charts?: DashboardChartConfig[];
  // tables?: DashboardTableConfig[];
  // layout?: DashboardLayoutItem[];
  // templateId?: string | null;
}

/**
 * Configuração do dashboard compartilhável por cliente. Registrada para a
 * fase futura: gerar link individual do cliente, ativar/desativar o link,
 * escolher acesso público ou protegido e, mais adiante, definir senha ou login.
 */
export interface ShareConfig {
  enabled: boolean;
  visibility: "public" | "protected";
  /** Slug do link público; `null` enquanto não gerado. */
  slug: string | null;
  // Futuro: passwordHash?: string; allowedEmails?: string[];
}

export const DEFAULT_SHARE_CONFIG: ShareConfig = {
  enabled: false,
  visibility: "protected",
  slug: null,
};

/** Estado da última sincronização de dados do cliente. */
export type SyncState = "ok" | "stale" | "error" | "never";

export interface Client {
  id: string;
  /** Nome público / comercial. */
  name: string;
  /** Identificação interna usada pela equipe Bernal (opcional). */
  internalName: string;
  status: ClientStatus;
  metaStatus: MetaConnectionStatus;
  /** Score de saúde mockado (0–100). */
  healthScore: number;
  createdAt: string;
  logoUrl: string | null;
  /** Configuração de dashboard específica do cliente. */
  dashboardConfig: DashboardConfig;
  /** Configuração de compartilhamento específica do cliente. */
  shareConfig: ShareConfig;
  /** Rótulo relativo da última sincronização (mock nesta fase). */
  lastSyncLabel: string;
  syncState: SyncState;
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
