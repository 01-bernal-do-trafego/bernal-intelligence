/**
 * Tipos da resposta CRUA da Meta Marketing API (o que a API devolve) e dos
 * objetos JÁ NORMALIZADOS pelo Bernal. Nenhum segredo aqui.
 *
 * Níveis da hierarquia Meta:
 *   account → campaign → adset → ad → creative
 * `creative-analysis` NÃO é um nível de insights: é derivado de ad + creative
 * + insights (o mesmo criativo pode aparecer em vários anúncios).
 */

export type MetaEntityLevel = "account" | "campaign" | "adset" | "ad" | "creative";

/** Nível em que insights são efetivamente coletados e armazenados. */
export type MetaInsightLevel = "account" | "campaign" | "adset" | "ad";

/* ----------------------------- respostas cruas ---------------------------- */

export interface MetaPagingRaw {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

export interface MetaListResponse<T> {
  data: T[];
  paging?: MetaPagingRaw;
}

export interface MetaErrorRaw {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

export interface MetaAdAccountRaw {
  id: string; // "act_123..."
  account_id?: string; // "123..."
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  timezone_offset_hours_utc?: number;
  business?: { id?: string; name?: string };
}

export interface MetaCampaignRaw {
  id: string;
  account_id?: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  created_time?: string;
  updated_time?: string;
  start_time?: string;
  stop_time?: string;
}

export interface MetaAdSetRaw {
  id: string;
  campaign_id?: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  promoted_object?: Record<string, unknown>;
  created_time?: string;
  updated_time?: string;
}

export interface MetaAdRaw {
  id: string;
  adset_id?: string;
  campaign_id?: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: { id?: string };
  created_time?: string;
  updated_time?: string;
}

export interface MetaCreativeRaw {
  id: string;
  name?: string;
  object_type?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  title?: string;
  body?: string;
  object_story_spec?: Record<string, unknown>;
  asset_feed_spec?: Record<string, unknown>;
  call_to_action_type?: string;
  [key: string]: unknown;
}

/** Entrada de `actions[]` / `action_values[]` (valores por janela de atribuição). */
export interface MetaActionRaw {
  action_type: string;
  value?: string;
  /** chaves de janela: "1d_view", "7d_click", "7d_click_1d_view", ... */
  [attributionWindow: string]: string | undefined;
}

export interface MetaInsightRaw {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;

  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  frequency?: string;

  actions?: MetaActionRaw[];
  action_values?: MetaActionRaw[];

  video_thruplay_watched_actions?: MetaActionRaw[];
  video_3_sec_watched_actions?: MetaActionRaw[];
  video_avg_time_watched_actions?: MetaActionRaw[];

  [key: string]: unknown;
}

/* --------------------------- objetos normalizados ----------------------- */

export interface NormalizedInsightRow {
  level: MetaInsightLevel;
  /** id Meta da entidade daquele nível ("act_..." p/ account). */
  entityId: string;
  adAccountId: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  date: string; // YYYY-MM-DD
  attributionWindow: string;
  currency: string | null;

  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  inlineLinkClicks: number | null;
  frequency: number | null;
  video3sViews: number | null;
  videoThruplays: number | null;
  videoAvgTimeWatched: number | null;

  /** id de métrica Bernal -> contagem somada. */
  actions: Record<string, number>;
  /** id de métrica de valor Bernal -> valor somado. */
  actionValues: Record<string, number>;
  /** `action_type`s da Meta que ainda não mapeamos (auditoria). */
  unmappedActions: { actionType: string; value: number }[];
}
