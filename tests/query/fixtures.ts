/**
 * Fixtures de teste da Query Layer — não é um arquivo de teste (não termina em
 * `.test.ts`), só builders compartilhados.
 */
import type {
  NormalizedDailyRow,
  NormalizedPeriodicRow,
  QueryScope,
} from "@/lib/query/types";

export const CLIENT_ID = "client-1";
export const ACCOUNT_ID = "act_1";

export const SCOPE_SINGLE: QueryScope = {
  clientId: CLIENT_ID,
  level: "account",
  entityIds: [ACCOUNT_ID],
};

export function scopeWith(entityIds: string[], level: QueryScope["level"] = "account"): QueryScope {
  return { clientId: CLIENT_ID, level, entityIds };
}

export function dailyRow(
  overrides: Partial<NormalizedDailyRow> & { date: string },
): NormalizedDailyRow {
  return {
    client_id: CLIENT_ID,
    level: "account",
    entity_id: ACCOUNT_ID,
    attribution_window: "unified_attribution",
    spend: null,
    impressions: null,
    clicks: null,
    inline_link_clicks: null,
    reach: null,
    frequency: null,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: null,
    action_values: null,
    raw_actions: null,
    raw_action_values: null,
    ...overrides,
  };
}

export function periodicRow(
  overrides: Partial<NormalizedPeriodicRow> & {
    date_from: string;
    date_to: string;
  },
): NormalizedPeriodicRow {
  return {
    client_id: CLIENT_ID,
    level: "account",
    entity_id: ACCOUNT_ID,
    attribution_window: "unified_attribution",
    period_key: "custom",
    spend: null,
    impressions: null,
    clicks: null,
    inline_link_clicks: null,
    reach: null,
    frequency: null,
    video_3s_views: null,
    video_thruplays: null,
    video_avg_time_watched: null,
    actions: null,
    action_values: null,
    raw_actions: null,
    raw_action_values: null,
    ...overrides,
  };
}
