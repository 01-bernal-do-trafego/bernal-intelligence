/**
 * DATA V2.2.3 — Real Backfill Executor. Linha de `meta_insights_daily` pronta
 * para UPSERT. Módulo PURO — só o TIPO + uma defesa extra de deduplicação;
 * NENHUMA normalização de campo Meta acontece aqui (isso é
 * `supabase/functions/_shared/insights.ts#toDailyRows`, reutilizado tal como
 * está pelo executor real — ver `docs/DATA-FOUNDATION-V2.md`, seção V2.2.3).
 *
 * *** POR QUE NÃO `lib/query/types.ts#NormalizedDailyRow` (usado na V2.2.2) ***
 * A fundação da V2.2.2 usava `NormalizedDailyRow` (Query Layer, DATA V2.1)
 * como o tipo das portas `fetchInsights`/`upsertDaily` do executor — um
 * placeholder razoável enquanto a execução real não existia (nenhum
 * consumidor dependia do formato exato ainda). A auditoria desta etapa
 * (V2.2.3) achou que esse tipo NÃO é suficiente para popular
 * `meta_insights_daily` de verdade: falta `ad_account_ref`/`ad_account_id`
 * (NOT NULL na tabela) e `campaign_id`/`adset_id`/`ad_id` (exigidos pelo
 * CHECK `meta_insights_daily_level_ids` conforme o nível) — a Query Layer
 * resolve esses campos via `QueryScope` (fora da linha), mas uma linha de
 * INSERT real precisa deles NA PRÓPRIA linha, uma vez que uma página de
 * insights `level=ad`, por exemplo, mistura vários `ad_id` diferentes.
 *
 * Por isso o CONTRATO do executor muda para `BackfillInsightRow` nesta etapa
 * — estruturalmente IDÊNTICO ao `DbInsightRow`/`DailyInsightRow` que
 * `_shared/insights.ts#toDailyRows` já produz para o Current Sync. Mudança
 * de tipo feita às claras (não silenciosa) — reportada explicitamente na
 * entrega da V2.2.3.
 */

import type { BackfillLevel } from "./types";

export interface BackfillInsightRow {
  client_id: string;
  ad_account_ref: string;
  level: BackfillLevel;
  entity_id: string;
  ad_account_id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  date: string;
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

/** Mesma natural key do `UNIQUE(level, entity_id, date, attribution_window)` de `meta_insights_daily`. */
export function naturalKey(
  row: Pick<BackfillInsightRow, "level" | "entity_id" | "date" | "attribution_window">,
): string {
  return `${row.level}|${row.entity_id}|${row.date}|${row.attribution_window}`;
}

/**
 * Defesa EXTRA — não é o que garante idempotência (isso é o `UNIQUE` +
 * `upsert(onConflict: ...)` no banco, já provado pelo Current Sync V1).
 * Se, por algum motivo, a MESMA linha aparecesse duas vezes dentro da MESMA
 * chamada (não deveria — a Graph não repagina o mesmo registro dentro de um
 * único fetch), mantém só a ÚLTIMA ocorrência (ordem de chegada) em vez de
 * mandar duplicata ao upsert.
 */
export function dedupeRows(rows: readonly BackfillInsightRow[]): BackfillInsightRow[] {
  const byKey = new Map<string, BackfillInsightRow>();
  for (const row of rows) byKey.set(naturalKey(row), row);
  return [...byKey.values()];
}
