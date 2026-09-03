/**
 * Edge Function: meta-sync-scheduled (BACKEND / CRON)
 * ---------------------------------------------------------------------------
 * `verify_jwt = false` — NÃO usa JWT de usuário. Autorização = um secret
 * dedicado de alta entropia (`META_SYNC_CRON_SECRET`), enviado pelo pg_cron no
 * header e comparado em TEMPO CONSTANTE. Finalidade única: autorizar o
 * scheduler. Sem publishable key como auth, sem service role no browser, sem
 * secret em query string, sem log de secret.
 *
 *   POST { clientId }
 *   header: x-meta-sync-cron-secret: <META_SYNC_CRON_SECRET>
 *
 * O dispatcher (pg_cron a cada 15 min) chama `meta_clients_due_for_sync(8, '4h')`
 * e dispara 1 POST por cliente. Cada invocação sincroniza UM cliente, reusando
 * o mesmo `runClientSync` do caminho manual (acquire atômico, agrupamento por
 * conexão, token só no backend).
 *
 * O deploy DEVE usar `--no-verify-jwt`.
 */

import { json, requireEnv } from "../_shared/http.ts";
import { resolveSecretKey } from "../_shared/supabase.ts";
import { runClientSync } from "../_shared/sync-core.ts";

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

/** compara duas strings em tempo constante (evita timing oracle). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // length difference já é sinal, mas ainda percorre para não vazar por tempo
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let SUPABASE_URL: string;
  let SECRET_KEY: string;
  let ENC_KEY: string;
  let CRON_SECRET: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
    CRON_SECRET = requireEnv("META_SYNC_CRON_SECRET");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  // -- auth backend-only: secret dedicado, tempo constante --
  const provided = req.headers.get("x-meta-sync-cron-secret") ?? "";
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as { clientId?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return json({ error: "bad_request" }, 400);

  const result = await runClientSync(
    {
      supabaseUrl: SUPABASE_URL,
      secretKey: SECRET_KEY,
      encKey: ENC_KEY,
      graphBase: GRAPH_BASE,
      graphVersion: GRAPH_VERSION,
    },
    { clientId, trigger: "cron", createdBy: null },
  );

  if (!result.ok) {
    // sync_already_running / no_eligible_account não são falha do scheduler.
    return json({ status: "skipped", reason: result.reason ?? "unknown" }, 200);
  }

  const anyOk = result.results.some(
    (r) => r.status === "success" || r.status === "partial",
  );
  return json({
    status: anyOk ? "ok" : "error",
    trigger: "cron",
    batchId: result.batchId,
    results: result.results,
  });
});
