/**
 * Parsing das contas de anúncio da Graph API (Edge Function / Deno).
 *
 * Espelha lib/meta/ad-account.ts do app Next (fronteira Deno — não dá para
 * importar de lib/). A versão do app é a que tem testes; mantenha as duas
 * em sincronia se os campos da Meta mudarem.
 */

export interface DiscoveredAdAccount {
  adAccountId: string;
  name: string | null;
  accountStatus: number | null;
  currency: string | null;
  timezoneName: string | null;
  timezoneOffsetUtc: number | null;
  businessId: string | null;
  businessName: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.trunc(Number(v));
  }
  return null;
}

function normalizeAdAccountId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim();
  if (/^act_\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `act_${v}`;
  return null;
}

function parseNode(node: unknown): DiscoveredAdAccount | null {
  if (typeof node !== "object" || node === null) return null;
  const n = node as Record<string, unknown>;
  const adAccountId =
    normalizeAdAccountId(n.id) ?? normalizeAdAccountId(n.account_id);
  if (!adAccountId) return null;

  const business =
    typeof n.business === "object" && n.business !== null
      ? (n.business as Record<string, unknown>)
      : null;

  return {
    adAccountId,
    name: str(n.name),
    accountStatus: intOrNull(n.account_status),
    currency: str(n.currency),
    timezoneName: str(n.timezone_name),
    timezoneOffsetUtc: intOrNull(n.timezone_offset_hours_utc),
    businessId: business ? str(business.id) : null,
    businessName: business ? str(business.name) : null,
  };
}

/** Junta páginas e remove duplicatas por adAccountId. Nós inválidos caem fora. */
export function parseAdAccountPages(pages: unknown[][]): DiscoveredAdAccount[] {
  const seen = new Set<string>();
  const out: DiscoveredAdAccount[] = [];
  for (const page of pages) {
    if (!Array.isArray(page)) continue;
    for (const node of page) {
      const parsed = parseNode(node);
      if (!parsed || seen.has(parsed.adAccountId)) continue;
      seen.add(parsed.adAccountId);
      out.push(parsed);
    }
  }
  return out;
}
