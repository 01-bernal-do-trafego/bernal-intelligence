/**
 * Edge Function: meta-oauth-exchange
 * ---------------------------------------------------------------------------
 * Troca SEGURA do authorization code da Meta por um access token e persistência
 * da credencial cifrada. É a ÚNICA camada que enxerga o `client_secret` e o
 * token em claro.
 *
 * Chamada por: o route handler `/api/meta/oauth/callback` do Next, server-to-
 * server, com `Authorization: Bearer <access_token do usuário Supabase>` e
 * body `{ code, clientId }`. Nunca é chamada pelo browser.
 *
 * Ordem (privilégio mínimo no tempo):
 *   1. Valida o JWT do chamador (auth.getUser) com a chave PUBLISHABLE.
 *   2. Autoriza: papel de agência + acesso ao cliente (leituras via RLS com o
 *      JWT do usuário — profiles/clients).
 *   -- só depois disso os SEGREDOS da Meta e a chave SECRETA são lidos --
 *   3. Troca `code` -> access token (server-to-server, com client_secret).
 *   4. GET /debug_token para metadados (scopes, expiração, tipo, business).
 *   5. Cifra o token (AES-256-GCM, IV novo por token).
 *   6. Grava tudo numa transação via RPC `meta_oauth_upsert_connection`
 *      (client administrativo). NENHUM token/segredo na resposta.
 *
 * Chaves do Supabase: NÃO cadastradas manualmente. Legadas
 * (SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) auto-injetadas, com fallback
 * para o formato 2026 (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS) —
 * ver ../_shared/supabase.ts.
 *
 * Secrets que o usuário cadastra (supabase secrets set):
 *   META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI, META_TOKEN_ENC_KEY
 *   (META_GRAPH_VERSION / META_GRAPH_BASE opcionais)
 *
 * LOGGING: só uma linha SANITIZADA no caminho de `exchange_failed` — status
 * HTTP da Meta, error.type/code/error_subcode e a mensagem já redigida/truncada
 * (ver _shared/graph.ts → SanitizedExchangeError). NUNCA authorization code,
 * access token, App Secret, chave de cifra, JWT, header Authorization nem corpo
 * cru. Nada disso vai para a resposta.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolvePublishableKey, resolveSecretKey } from "../_shared/supabase.ts";
import { sealToken } from "../_shared/crypto.ts";
import {
  debugToken,
  exchangeCodeForToken,
  MetaExchangeError,
} from "../_shared/graph.ts";

const GRAPH_BASE =
  Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

type TokenType = "user" | "system_user" | "system_user_60d" | "system_user_manual";
type ConnStatus =
  | "active"
  | "expiring"
  | "expired"
  | "revoked"
  | "reauthorization_required";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  // --- infra mínima para identificar o chamador -------------------------------
  let SUPABASE_URL: string;
  let PUBLISHABLE_KEY: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    PUBLISHABLE_KEY = resolvePublishableKey();
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  // 1. Identidade do chamador (antes de qualquer operação privilegiada)
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "unauthorized" }, 401);

  // corpo
  const body = (await req.json().catch(() => null)) as
    | { code?: unknown; clientId?: unknown }
    | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!code || !clientId) return json({ error: "bad_request" }, 400);

  // 2. Autorização: papel de agência + acesso ao cliente (via RLS)
  const { data: profile } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== "agency_admin" && role !== "agency_member") {
    return json({ error: "forbidden" }, 403);
  }
  const { data: client } = await userClient
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return json({ error: "forbidden" }, 403);

  // --- a partir daqui: segredos da Meta + chave administrativa ---------------
  let APP_ID: string;
  let APP_SECRET: string;
  let REDIRECT_URI: string;
  let ENC_KEY: string;
  let SECRET_KEY: string;
  try {
    APP_ID = requireEnv("META_APP_ID");
    APP_SECRET = requireEnv("META_APP_SECRET");
    REDIRECT_URI = requireEnv("META_OAUTH_REDIRECT_URI");
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
    SECRET_KEY = resolveSecretKey();
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  // 3. Troca do code (sem detalhe do erro na resposta; log só sanitizado)
  let token;
  try {
    token = await exchangeCodeForToken({
      graphBase: GRAPH_BASE,
      version: GRAPH_VERSION,
      appId: APP_ID,
      appSecret: APP_SECRET,
      redirectUri: REDIRECT_URI,
      code,
    });
  } catch (err) {
    if (err instanceof MetaExchangeError) {
      console.error(
        JSON.stringify({ evt: "meta_oauth_exchange_failed", clientId, ...err.sanitized }),
      );
    } else {
      console.error(
        JSON.stringify({
          evt: "meta_oauth_exchange_failed",
          clientId,
          category: "unexpected",
        }),
      );
    }
    return json({ error: "exchange_failed" }, 502);
  }

  // 4. Metadados
  const info = await debugToken({
    graphBase: GRAPH_BASE,
    version: GRAPH_VERSION,
    appId: APP_ID,
    appSecret: APP_SECRET,
    token: token.accessToken,
  }).catch(() => null);

  const scopes = info?.scopes ?? [];
  const expiresAt = info?.expiresAt ?? null;
  const dataAccessExpiresAt = info?.dataAccessExpiresAt ?? null;
  const metaUserId = info?.metaUserId ?? null;
  const metaBusinessId = info?.metaBusinessId ?? null;
  const tokenType: TokenType = info?.isSystemUser
    ? expiresAt
      ? "system_user_60d"
      : "system_user"
    : "user";

  // status inicial: system user sem expiração => active; com expiração próxima
  // (< 7 dias) => expiring. A vigilância fina fica para META 6.
  let status: ConnStatus = "active";
  if (expiresAt) {
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft <= 0) status = "expired";
    else if (msLeft < 7 * 24 * 60 * 60 * 1000) status = "expiring";
  }

  // 5. Cifra (falha aqui => nada é persistido)
  let sealed;
  try {
    sealed = await sealToken(token.accessToken, ENC_KEY);
  } catch {
    return json({ error: "encrypt_failed" }, 500);
  }

  // 6. Persistência atômica (client administrativo)
  const admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: connectionId, error: rpcErr } = await admin.rpc(
    "meta_oauth_upsert_connection",
    {
      p_client_id: clientId,
      p_token_type: tokenType,
      p_meta_user_id: metaUserId,
      p_meta_business_id: metaBusinessId,
      p_scopes: scopes,
      p_status: status,
      p_expires_at: expiresAt,
      p_data_access_expires_at: dataAccessExpiresAt,
      p_created_by: user.id,
      p_token_cipher_b64: sealed.cipherB64,
      p_token_iv_b64: sealed.ivB64,
      p_token_tag_b64: sealed.tagB64,
      p_key_version: 1,
    },
  );
  if (rpcErr) {
    return json({ error: "persist_failed" }, 500);
  }

  // Resposta: só metadados não sensíveis. NUNCA token/cipher/iv/tag.
  return json({
    status: "connected",
    connectionId,
    tokenType,
    connectionStatus: status,
    scopes,
    expiresAt,
  });
});
