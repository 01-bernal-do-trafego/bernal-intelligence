"use server";

import { revalidatePath } from "next/cache";
import { isAgencyRole } from "@/lib/roles";
import type { ClientAdAccount } from "@/lib/meta/ad-account";
import { getSessionContext } from "@/supabase/auth";
import { getClientRecord } from "@/server/clients";
import { callMetaFunction } from "@/server/meta-function";

export type MetaAccountsActionResult =
  | { ok: true; accounts: ClientAdAccount[]; discoveredCount?: number }
  | { ok: false; reason: string };

interface FunctionAccountsResponse {
  accounts?: unknown;
  discoveredCount?: unknown;
}

const ACT_RE = /^act_\d+$/;

function coerceAccounts(value: unknown): ClientAdAccount[] {
  if (!Array.isArray(value)) return [];
  const out: ClientAdAccount[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.adAccountId !== "string" || !ACT_RE.test(r.adAccountId)) continue;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.length > 0 ? v : null;
    out.push({
      adAccountId: r.adAccountId,
      name: str(r.name),
      accountStatus: num(r.accountStatus),
      currency: str(r.currency),
      timezoneName: str(r.timezoneName),
      timezoneOffsetUtc: num(r.timezoneOffsetUtc),
      businessId: str(r.businessId),
      businessName: str(r.businessName),
      isLinked: r.isLinked === true,
      syncEnabled: r.syncEnabled === true,
    });
  }
  return out;
}

async function guard(
  clientId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { user, profile } = await getSessionContext();
  if (!user) return { ok: false, reason: "session" };
  if (!profile || !isAgencyRole(profile.role)) {
    return { ok: false, reason: "forbidden" };
  }
  // RLS: só retorna o cliente se a sessão puder acessá-lo.
  const client = await getClientRecord(clientId);
  if (!client) return { ok: false, reason: "not_connected" };
  return { ok: true };
}

/** Descobre as contas de anúncio disponíveis na conexão Meta do cliente. */
export async function discoverAdAccounts(
  clientId: string,
): Promise<MetaAccountsActionResult> {
  const g = await guard(clientId);
  if (!g.ok) return g;

  const res = await callMetaFunction<FunctionAccountsResponse>(
    "meta-ad-accounts",
    { action: "discover", clientId },
  );
  if (!res.ok) return { ok: false, reason: res.reason };

  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    accounts: coerceAccounts(res.data.accounts),
    discoveredCount:
      typeof res.data.discoveredCount === "number"
        ? res.data.discoveredCount
        : undefined,
  };
}

/** Define quais contas ficam vinculadas ao dashboard do cliente. */
export async function saveLinkedAdAccounts(
  clientId: string,
  adAccountIds: string[],
): Promise<MetaAccountsActionResult> {
  const g = await guard(clientId);
  if (!g.ok) return g;

  const ids = [
    ...new Set(
      (Array.isArray(adAccountIds) ? adAccountIds : [])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => ACT_RE.test(v)),
    ),
  ];

  const res = await callMetaFunction<FunctionAccountsResponse>(
    "meta-ad-accounts",
    { action: "link", clientId, linkAdAccountIds: ids },
  );
  if (!res.ok) return { ok: false, reason: res.reason };

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, accounts: coerceAccounts(res.data.accounts) };
}
