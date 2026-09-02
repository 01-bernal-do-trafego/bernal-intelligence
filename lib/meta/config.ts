/**
 * Configuração da integração com a Meta Marketing API.
 *
 * NÃO contém segredos. App ID / App Secret / tokens ficam em variáveis de
 * ambiente lidas apenas no servidor / Edge Function (fases seguintes).
 *
 * A versão da API fica centralizada AQUI. Upgrade futuro = mudar uma linha
 * e revisar o changelog da Meta.
 */

export const META_API_VERSION = "v26.0" as const;

export const META_GRAPH_BASE = "https://graph.facebook.com";

/** Monta uma URL da Graph API já com a versão fixada. */
export function metaGraphUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${META_GRAPH_BASE}/${META_API_VERSION}${clean}`;
}

/**
 * Identificador de atribuição gravado em cada linha de insight.
 *
 * `unified_attribution` = a sincronização NÃO força janela: a Insights API
 * (desde 10/06/2025) já retorna `actions`/`action_values` usando a
 * configuração de atribuição UNIFICADA de cada conjunto de anúncios, espelhando
 * o Ads Manager. `use_unified_attribution_setting` e `action_report_time` são
 * desconsiderados — não os passamos.
 *
 * As janelas explícitas abaixo ficam registradas para um recurso futuro de
 * "escolher a janela" (via `action_attribution_windows`). Hoje não são usadas.
 * (7d_view / 28d_view foram removidas pela Meta em 12/01/2026.)
 */
export const META_ATTRIBUTION_WINDOWS = [
  "unified_attribution",
  "1d_view",
  "7d_click",
  "1d_click",
  "7d_click_1d_view",
  "28d_click_1d_view",
] as const;

export type MetaAttributionWindow = (typeof META_ATTRIBUTION_WINDOWS)[number];

export const META_DEFAULT_ATTRIBUTION_WINDOW: MetaAttributionWindow =
  "unified_attribution";

/** Rótulo legado, mantido só na transição das linhas já sincronizadas. */
export const META_ATTRIBUTION_LEGACY_WINDOW = "7d_click_1d_view";

/**
 * Valores aceitos ao consultar insights no dashboard durante a transição —
 * `unified_attribution` (novo) + o rótulo legado das linhas ainda não
 * renomeadas. Nunca existem os dois para a MESMA chave de insight, então não há
 * ambiguidade. Remover o legado depois que todas as linhas forem renomeadas.
 */
export const META_ATTRIBUTION_QUERY_VALUES: readonly string[] = [
  META_DEFAULT_ATTRIBUTION_WINDOW,
  META_ATTRIBUTION_LEGACY_WINDOW,
];

const META_ATTRIBUTION_LABEL: Record<string, string> = {
  unified_attribution: "Configuração de atribuição da Meta (unified)",
  "7d_click_1d_view": "7 dias clique / 1 dia visualização",
  "28d_click_1d_view": "28 dias clique / 1 dia visualização",
  "7d_click": "7 dias clique",
  "1d_click": "1 dia clique",
  "1d_view": "1 dia visualização",
};

/** Rótulo legível de um identificador de atribuição para a UI administrativa. */
export function metaAttributionLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return META_ATTRIBUTION_LABEL[value] ?? value;
}

/** Escopos OAuth por fase (usado na configuração do Login for Business). */
export const META_SCOPES_BASE = ["ads_read", "business_management"] as const;
export const META_SCOPES_FULL = [
  "ads_read",
  "ads_management",
  "business_management",
] as const;
