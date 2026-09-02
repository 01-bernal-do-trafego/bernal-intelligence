import "server-only";

import { cache } from "react";
import { getAuthMode } from "@/supabase/config";
import { createSupabaseServerClient } from "@/supabase/server";
import { getMetaConnection } from "@/server/meta-connection";
import { listMetaAdAccounts } from "@/server/meta-ad-accounts";
import { metaIsUsable } from "@/lib/meta/connection-state";

export type DashboardDataStatus = "real" | "awaiting_sync" | "no_meta" | "demo";

export interface LinkedAccountInfo {
  adAccountId: string;
  name: string | null;
  currency: string | null;
  timezoneName: string | null;
}

export interface ClientDataMode {
  /** "demo" = modo demonstração de desenvolvimento (sem Supabase). */
  mode: "real" | "demo";
  dataStatus: DashboardDataStatus;
  linkedAccounts: LinkedAccountInfo[];
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

/**
 * Decide se o dashboard do cliente deve usar DADOS REAIS da Meta ou não —
 * e, se não, POR QUÊ (para a UI mostrar o estado certo, nunca mock disfarçado
 * de real).
 */
export const getClientDataMode = cache(
  async (clientId: string): Promise<ClientDataMode> => {
    // Modo demonstração só existe em desenvolvimento sem Supabase.
    if (getAuthMode() === "demo") {
      return {
        mode: "demo",
        dataStatus: "demo",
        linkedAccounts: [],
        lastSyncAt: null,
        lastSyncStatus: null,
      };
    }

    const base: ClientDataMode = {
      mode: "real",
      dataStatus: "no_meta",
      linkedAccounts: [],
      lastSyncAt: null,
      lastSyncStatus: null,
    };

    try {
      const connection = await getMetaConnection(clientId);
      if (!metaIsUsable(connection.state)) return base;

      const accounts = await listMetaAdAccounts(clientId);
      const linked = accounts
        .filter((a) => a.isLinked)
        .map((a) => ({
          adAccountId: a.adAccountId,
          name: a.name,
          currency: a.currency,
          timezoneName: a.timezoneName,
        }));
      if (linked.length === 0) return { ...base, dataStatus: "no_meta" };

      const supabase = await createSupabaseServerClient();
      const { data } = await supabase
        .from("meta_sync_runs")
        .select("status, finished_at, started_at")
        .eq("client_id", clientId)
        .in("status", ["success", "partial"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const run = data as Record<string, unknown> | null;
      if (!run) {
        return { ...base, dataStatus: "awaiting_sync", linkedAccounts: linked };
      }

      return {
        mode: "real",
        dataStatus: "real",
        linkedAccounts: linked,
        lastSyncAt:
          (typeof run.finished_at === "string" && run.finished_at) ||
          (typeof run.started_at === "string" && run.started_at) ||
          null,
        lastSyncStatus:
          typeof run.status === "string" ? run.status : null,
      };
    } catch {
      return base;
    }
  },
);
