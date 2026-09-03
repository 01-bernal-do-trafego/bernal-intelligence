import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import type {
  CreativesStatus,
  LastSyncStatus,
  PerformanceStatus,
} from "@/lib/meta/sync-health";

export interface ClientSyncHealth {
  performanceSyncedAt: string | null;
  performanceStatus: PerformanceStatus;
  lastSyncAt: string | null;
  lastSyncStatus: LastSyncStatus;
  creativesStatus: CreativesStatus;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/**
 * Estado de sincronização de um cliente, lido da view
 * `public.meta_client_sync_health` pela sessão atual (RLS via
 * `security_invoker`). `null` se o cliente não tem nenhum sync ou não é
 * acessível. NUNCA usa o admin client.
 */
export const getClientSyncHealth = cache(
  async (clientId: string): Promise<ClientSyncHealth | null> => {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase
        .from("meta_client_sync_health")
        .select(
          "performance_synced_at, performance_status, last_sync_at, last_sync_status, creatives_status",
        )
        .eq("client_id", clientId)
        .maybeSingle();
      if (!data) return null;
      const r = data as Record<string, unknown>;
      return {
        performanceSyncedAt: str(r.performance_synced_at),
        performanceStatus: (str(r.performance_status) ??
          "never") as PerformanceStatus,
        lastSyncAt: str(r.last_sync_at),
        lastSyncStatus: (str(r.last_sync_status) ?? "never") as LastSyncStatus,
        creativesStatus: (str(r.creatives_status) ?? "never") as CreativesStatus,
      };
    } catch {
      return null;
    }
  },
);
