import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import type { ClientAdAccount } from "@/lib/meta/ad-account";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toClientAdAccount(row: Record<string, unknown>): ClientAdAccount | null {
  const adAccountId = row.ad_account_id;
  if (typeof adAccountId !== "string") return null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    adAccountId,
    name: str(row.account_name),
    accountStatus: num(row.account_status),
    currency: str(row.currency),
    timezoneName: str(row.timezone_name),
    timezoneOffsetUtc: num(row.timezone_offset_utc),
    businessId: str(row.business_id),
    businessName: str(row.business_name),
    isLinked: row.is_linked === true,
    syncEnabled: row.sync_enabled === true,
  };
}

/**
 * Contas de anúncio já descobertas para o cliente, lidas de
 * `public.meta_ad_accounts` via RLS (SELECT liberado só para quem acessa o
 * cliente). Deduplica por `ad_account_id` (mantém a linha linkada, senão a
 * mais recente). Nunca chama a Meta.
 */
export const listMetaAdAccounts = cache(
  async (clientId: string): Promise<ClientAdAccount[]> => {
    if (!UUID_RE.test(clientId)) return [];

    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("meta_ad_accounts")
        .select(
          "ad_account_id, account_name, account_status, currency, timezone_name, timezone_offset_utc, business_id, business_name, is_linked, sync_enabled, updated_at",
        )
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false });

      if (error || !data) return [];

      const byId = new Map<string, ClientAdAccount>();
      for (const raw of data as Record<string, unknown>[]) {
        const acc = toClientAdAccount(raw);
        if (!acc) continue;
        const existing = byId.get(acc.adAccountId);
        if (!existing || (acc.isLinked && !existing.isLinked)) {
          byId.set(acc.adAccountId, acc);
        }
      }
      return [...byId.values()].sort((a, b) =>
        (a.name ?? a.adAccountId).localeCompare(b.name ?? b.adAccountId, "pt-BR"),
      );
    } catch {
      return [];
    }
  },
);

export function linkedMetaAdAccounts(
  accounts: readonly ClientAdAccount[],
): ClientAdAccount[] {
  return accounts.filter((a) => a.isLinked);
}
