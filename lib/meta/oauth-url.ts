/**
 * Construção das URLs do OAuth da Meta (Facebook Login for Business).
 *
 * Módulo PURO: recebe tudo por parâmetro, não lê `process.env`, não importa
 * nada de servidor. Testável isoladamente.
 *
 * Fluxo (2026, Login for Business + system-user token):
 *   1. redirect do usuário  -> {loginBase}/{version}/dialog/oauth
 *        client_id, config_id (substitui `scope`), redirect_uri,
 *        response_type=code, override_default_response_type=true, state
 *   2. troca server-to-server -> {graphBase}/{version}/oauth/access_token
 *        client_id, client_secret, redirect_uri (idêntico ao passo 1), code
 *
 * `config_id` carrega as permissões (ads_read + business_management) escolhidas
 * na Configuration do painel Meta — não mandamos `scope` na URL.
 */

export interface AuthorizationUrlInput {
  /** Ex.: "https://www.facebook.com" */
  loginBase: string;
  /** Ex.: "v26.0" */
  version: string;
  /** META_APP_ID */
  appId: string;
  /** Configuration ID da Facebook Login for Business */
  configId: string;
  /** Deve bater exatamente com um "Valid OAuth Redirect URI" do app */
  redirectUri: string;
  /** Token anti-CSRF (o nonce; o payload completo fica no cookie httpOnly) */
  state: string;
}

/** URL do diálogo de autorização para onde o usuário é redirecionado. */
export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const base = input.loginBase.replace(/\/+$/, "");
  const url = new URL(`${base}/${input.version}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface TokenExchangeUrlInput {
  /** Ex.: "https://graph.facebook.com" */
  graphBase: string;
  version: string;
  appId: string;
  appSecret: string;
  /** Idêntico ao usado no diálogo de autorização. */
  redirectUri: string;
  /** `code` recebido no callback. */
  code: string;
}

/**
 * URL da troca do `code` por access token. USADA APENAS server-to-server
 * (Edge Function) — nunca no browser, pois carrega o `client_secret`.
 * Mantida aqui só para referência/testes; a Edge Function tem a sua própria
 * cópia (fronteira Deno).
 */
export function buildTokenExchangeUrl(input: TokenExchangeUrlInput): string {
  const base = input.graphBase.replace(/\/+$/, "");
  const url = new URL(`${base}/${input.version}/oauth/access_token`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);
  return url.toString();
}
