import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import {
  metaUiStateFromRow,
  type MetaUiState,
} from "@/lib/meta/connection-state";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MetaConnectionSummary {
  state: MetaUiState;
  /** `null` = não expira (token de system user). */
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  statusReason: string | null;
}

const DISCONNECTED: MetaConnectionSummary = {
  state: "not_connected",
  expiresAt: null,
  lastVerifiedAt: null,
  statusReason: null,
};

/**
 * Resumo da conexão Meta do cliente. Lê `public.meta_connections` via RLS
 * (SELECT liberado só para a equipe com acesso ao cliente). A tabela não tem
 * token — o app nunca o vê. Qualquer erro/ausência => "não conectado".
 *
 * Cacheado por request (usado no header e possivelmente em outros pontos).
 */
export const getMetaConnection = cache(
  async (clientId: string): Promise<MetaConnectionSummary> => {
    if (!UUID_RE.test(clientId)) return DISCONNECTED;

    let data: Record<string, unknown> | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      const result = await supabase
        .from("meta_connections")
        .select("status, has_secret, expires_at, last_verified_at, status_reason")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error || !result.data) return DISCONNECTED;
      data = result.data as Record<string, unknown>;
    } catch {
      return DISCONNECTED;
    }

    const row = data;
    return {
      state: metaUiStateFromRow({
        status: row.status,
        has_secret: row.has_secret,
      }),
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
      lastVerifiedAt:
        typeof row.last_verified_at === "string" ? row.last_verified_at : null,
      statusReason:
        typeof row.status_reason === "string" && row.status_reason.length > 0
          ? row.status_reason
          : null,
    };
  },
);
