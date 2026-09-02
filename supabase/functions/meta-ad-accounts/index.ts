/**
 * Edge Function: meta-ad-accounts
 * ---------------------------------------------------------------------------
 * META 3 — descobrir e vincular contas de anúncio de um cliente conectado.
 *
 * Chamada pelo servidor Next (server actions), server-to-server, com
 * `Authorization: Bearer <access_token do usuário Supabase>`. Nunca pelo browser.
 *
 *   POST { action: "discover", clientId }
 *     -> lê meta_connection_secrets (service_role), descriptografa o token só
 *        em memória, GET /me/adaccounts (paginado), upsert idempotente.
 *   POST { action: "link", clientId, linkAdAccountIds: string[] }
 *     -> define is_linked das contas escolhidas (barra conta de outro cliente).
 *
 * Ordem (privilégio mínimo no tempo):
 *   1. valida JWT do usuário
 *   2. papel de agência + acesso ao cliente (RLS)
 *   -- só então: segredos da função + chave administrativa --
 *   3. ação
 *
 * NUNCA retorna/loga: token da Meta, App Secret, bytes do segredo. Não há
 * console.* nesta função.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolvePublishableKey, resolveSecretKey } from "../_shared/supabase.ts";
import { openToken } from "../_shared/crypto.ts";
import { GraphApiError, listAdAccounts } from "../_shared/graph.ts";
import { parseAdAccountPages } from "../_shared/ad-account.ts";

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

interface ConnRow {
  id: string;
  status: string;
  has_secret: boolean;
}

function mapAccounts(rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    return {
      adAccountId: x.ad_account_id,
      name: x.account_name ?? null,
      accountStatus: x.account_status ?? null,
      currency: x.currency ?? null,
      timezoneName: x.timezone_name ?? null,
      timezoneOffsetUtc: x.timezone_offset_utc ?? null,
      businessId: x.business_id ?? null,
      businessName: x.business_name ?? null,
      isLinked: Boolean(x.is_linked),
      syncEnabled: Boolean(x.sync_enabled),
    };
  });
}

async function loadConnection(
  admin: AnyClient,
  clientId: string,
): Promise<ConnRow | null> {
  const { data } = await admin
    .from("meta_connections")
    .select("id, status, has_secret")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConnRow | null) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let SUPABASE_URL: string;
  let PUBLISHABLE_KEY: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    PUBLISHABLE_KEY = resolvePublishableKey();
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  // 1. Identidade do chamador
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; clientId?: unknown; linkAdAccountIds?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId || (action !== "discover" && action !== "link")) {
    return json({ error: "bad_request" }, 400);
  }

  // 2. Autorização
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

  // -- segredos + client administrativo --
  let SECRET_KEY: string;
  let ENC_KEY: string;
  try {
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }
  const admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const conn = await loadConnection(admin, clientId);
  if (!conn) return json({ error: "not_connected" }, 409);
  if (!conn.has_secret) return json({ error: "no_connection_secret" }, 409);

  // -------------------------------------------------------------------------
  if (action === "link") {
    const ids = Array.isArray(body?.linkAdAccountIds)
      ? [
          ...new Set(
            (body!.linkAdAccountIds as unknown[])
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim())
              .filter((v) => /^act_\d+$/.test(v)),
          ),
        ]
      : [];

    const { data, error } = await admin.rpc("meta_set_linked_accounts", {
      p_connection_id: conn.id,
      p_client_id: clientId,
      p_link_ids: ids,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("account_linked_elsewhere")) {
        return json({ error: "account_linked_elsewhere" }, 409);
      }
      return json({ error: "link_failed" }, 500);
    }
    return json({ status: "ok", accounts: mapAccounts(data) });
  }

  // -------------------------------------------------------------------------
  // action === "discover"
  const { data: secret } = await admin
    .from("meta_connection_secrets")
    .select("token_cipher, token_iv, token_tag")
    .eq("connection_id", conn.id)
    .maybeSingle();
  const s = secret as
    | { token_cipher: string; token_iv: string; token_tag: string }
    | null;
  if (!s) return json({ error: "no_connection_secret" }, 409);

  let token: string;
  try {
    token = await openToken(
      { cipher: s.token_cipher, iv: s.token_iv, tag: s.token_tag },
      ENC_KEY,
    );
  } catch {
    return json({ error: "decrypt_failed" }, 500);
  }

  let pages: unknown[][];
  try {
    pages = await listAdAccounts({
      graphBase: GRAPH_BASE,
      version: GRAPH_VERSION,
      token,
    });
  } catch (err) {
    if (err instanceof GraphApiError) {
      if (err.kind === "token_revoked") {
        await admin
          .from("meta_connections")
          .update({
            status: "reauthorization_required",
            status_reason: "token_revoked",
            last_error: "token_revoked",
            last_verified_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
      }
      return json({ error: err.kind }, err.kind === "rate_limited" ? 429 : 409);
    }
    return json({ error: "unknown" }, 502);
  }

  const discovered = parseAdAccountPages(pages);

  const { data, error } = await admin.rpc("meta_upsert_ad_accounts", {
    p_connection_id: conn.id,
    p_client_id: clientId,
    p_accounts: discovered,
  });
  if (error) return json({ error: "persist_failed" }, 500);

  // marca a conexão como verificada agora
  await admin
    .from("meta_connections")
    .update({ last_verified_at: new Date().toISOString(), last_error: null })
    .eq("id", conn.id);

  return json({
    status: "ok",
    discoveredCount: discovered.length,
    accounts: mapAccounts(data),
  });
});
