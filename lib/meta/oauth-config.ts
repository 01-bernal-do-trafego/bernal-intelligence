/**
 * Leitura das variáveis de ambiente do OAuth da Meta (lado Next / servidor).
 *
 * NENHUMA destas é segredo:
 *   META_APP_ID            — ID público do app (Meta → App settings → Basic)
 *   META_OAUTH_CONFIG_ID   — Configuration ID da Facebook Login for Business
 *   META_OAUTH_REDIRECT_URI— URL do nosso /callback (tem que bater com o painel)
 *   META_LOGIN_BASE_URL    — opcional; default https://www.facebook.com
 *
 * O `client_secret` (META_APP_SECRET) e a chave de cifra (META_TOKEN_ENC_KEY)
 * NÃO são lidos aqui — vivem só nos secrets da Edge Function.
 *
 * Sem `import "server-only"` de propósito (mantém testável), mas só deve ser
 * importado por route handlers / código de servidor.
 */

import { META_API_VERSION } from "./config";

export const META_APP_ID = process.env.META_APP_ID ?? "";
export const META_OAUTH_CONFIG_ID = process.env.META_OAUTH_CONFIG_ID ?? "";
export const META_OAUTH_REDIRECT_URI = process.env.META_OAUTH_REDIRECT_URI ?? "";
export const META_LOGIN_BASE_URL =
  process.env.META_LOGIN_BASE_URL ?? "https://www.facebook.com";

export interface MetaOAuthConfig {
  appId: string;
  configId: string;
  redirectUri: string;
  loginBase: string;
  version: string;
}

/** `true` quando dá para iniciar o fluxo de OAuth neste ambiente. */
export function isMetaOAuthConfigured(): boolean {
  return (
    META_APP_ID.length > 0 &&
    META_OAUTH_CONFIG_ID.length > 0 &&
    META_OAUTH_REDIRECT_URI.length > 0
  );
}

export function metaOAuthConfig(): MetaOAuthConfig {
  return {
    appId: META_APP_ID,
    configId: META_OAUTH_CONFIG_ID,
    redirectUri: META_OAUTH_REDIRECT_URI,
    loginBase: META_LOGIN_BASE_URL,
    version: META_API_VERSION,
  };
}
