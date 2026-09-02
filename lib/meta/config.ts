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
 * Janelas de atribuição suportadas (parâmetro `action_attribution_windows`).
 * A janela usada é gravada em cada linha de insight para explicar diferenças
 * em relação ao Ads Manager.
 */
export const META_ATTRIBUTION_WINDOWS = [
  "1d_view",
  "7d_click",
  "1d_click",
  "7d_click_1d_view",
  "28d_click_1d_view",
] as const;

export type MetaAttributionWindow = (typeof META_ATTRIBUTION_WINDOWS)[number];

export const META_DEFAULT_ATTRIBUTION_WINDOW: MetaAttributionWindow =
  "7d_click_1d_view";

/** Escopos OAuth por fase (usado na configuração do Login for Business). */
export const META_SCOPES_BASE = ["ads_read", "business_management"] as const;
export const META_SCOPES_FULL = [
  "ads_read",
  "ads_management",
  "business_management",
] as const;
