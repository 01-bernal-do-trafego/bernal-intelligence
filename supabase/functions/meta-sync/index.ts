/**
 * Edge Function: meta-sync (MANUAL)
 * ---------------------------------------------------------------------------
 * Sincronização disparada por um usuário autenticado da agência.
 *
 *   POST { clientId }   Authorization: Bearer <access_token do usuário>
 *
 * Ordem de privilégio: valida JWT -> papel de agência -> cliente visível (RLS)
 * -> só então chama o núcleo compartilhado `runClientSync` (que acquire-a
 * ATÔMICO todas as contas elegíveis do cliente, agrupa por conexão, abre 1
 * token por conexão em memória e sincroniza). Token/App Secret NUNCA
 * retornados nem logados.
 *
 * O caminho SCHEDULED (cron) vive em `meta-sync-scheduled` (verify_jwt=false +
 * secret próprio) e chama o MESMO `runClientSync`.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolvePublishableKey, resolveSecretKey } from "../_shared/supabase.ts";
import { runClientSync } from "../_shared/sync-core.ts";

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let SUPABASE_URL: string;
  let PUBLISHABLE_KEY: string;
  let SECRET_KEY: string;
  let ENC_KEY: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    PUBLISHABLE_KEY = resolvePublishableKey();
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  // -- auth do usuário --
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { clientId?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return json({ error: "bad_request" }, 400);

  const { data: profile } = await userClient
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== "agency_admin" && role !== "agency_member") {
    return json({ error: "forbidden" }, 403);
  }
  const { data: client } = await userClient
    .from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return json({ error: "forbidden" }, 403);

  // -- núcleo compartilhado --
  const result = await runClientSync(
    {
      supabaseUrl: SUPABASE_URL,
      secretKey: SECRET_KEY,
      encKey: ENC_KEY,
      graphBase: GRAPH_BASE,
      graphVersion: GRAPH_VERSION,
    },
    { clientId, trigger: "manual", createdBy: user.id },
  );

  if (!result.ok) {
    const code = result.reason === "sync_already_running" ? 409 : 409;
    return json({ error: result.reason ?? "sync_failed" }, code);
  }

  const anyOk = result.results.some(
    (r) => r.status === "success" || r.status === "partial",
  );
  return json({
    status: anyOk ? "ok" : "error",
    trigger: "manual",
    batchId: result.batchId,
    dateFrom: result.dateFrom ?? null,
    dateTo: result.dateTo ?? null,
    results: result.results,
  });
});
