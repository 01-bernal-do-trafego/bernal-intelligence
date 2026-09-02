"use server";

import { revalidatePath } from "next/cache";
import { isAgencyRole } from "@/lib/roles";
import { getSessionContext } from "@/supabase/auth";
import { getClientRecord } from "@/server/clients";
import { callMetaFunction } from "@/server/meta-function";

export interface SyncRunResult {
  adAccountId: string;
  runId?: string;
  status?: "success" | "partial" | "error";
  error?: string;
  stats?: Record<string, unknown>;
}

export type SyncMetaActionResult =
  | { ok: true; results: SyncRunResult[]; dateFrom: string | null; dateTo: string | null }
  | { ok: false; reason: string };

interface SyncFunctionResponse {
  results?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
}

function coerceResults(value: unknown): SyncRunResult[] {
  if (!Array.isArray(value)) return [];
  const out: SyncRunResult[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.adAccountId !== "string") continue;
    out.push({
      adAccountId: r.adAccountId,
      runId: typeof r.runId === "string" ? r.runId : undefined,
      status:
        r.status === "success" || r.status === "partial" || r.status === "error"
          ? r.status
          : undefined,
      error: typeof r.error === "string" ? r.error : undefined,
      stats:
        r.stats && typeof r.stats === "object"
          ? (r.stats as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

/**
 * Sincroniza somente as contas vinculadas do cliente (últimos 30 dias,
 * estrutura + insights base). Server-to-server; o token nunca passa por aqui.
 */
export async function syncMeta(clientId: string): Promise<SyncMetaActionResult> {
  const { user, profile } = await getSessionContext();
  if (!user) return { ok: false, reason: "session" };
  if (!profile || !isAgencyRole(profile.role)) {
    return { ok: false, reason: "forbidden" };
  }
  const client = await getClientRecord(clientId);
  if (!client) return { ok: false, reason: "not_connected" };

  const res = await callMetaFunction<SyncFunctionResponse>("meta-sync", {
    clientId,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  revalidatePath(`/clients/${clientId}/meta-data`);
  revalidatePath(`/clients/${clientId}`);

  return {
    ok: true,
    results: coerceResults(res.data.results),
    dateFrom: typeof res.data.dateFrom === "string" ? res.data.dateFrom : null,
    dateTo: typeof res.data.dateTo === "string" ? res.data.dateTo : null,
  };
}
