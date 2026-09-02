/**
 * Contas de anúncio da Meta — parsing e normalização. Módulo PURO.
 *
 * A descoberta acontece na Edge Function (server-to-server, com o token
 * descriptografado só em memória). Estes helpers transformam o retorno cru da
 * Graph API (`GET /me/adaccounts`) no formato que persistimos em
 * `public.meta_ad_accounts` e exibimos na UI.
 *
 * Regra: o identificador é SEMPRE o id da Meta (`act_<n>`), nunca o nome.
 */

/** Conta como descoberta na Meta (antes de qualquer escolha do usuário). */
export interface DiscoveredAdAccount {
  /** `act_<n>` — id global da Meta. */
  adAccountId: string;
  name: string | null;
  /** Código numérico da Meta (1 = ativa). `null` se ausente. */
  accountStatus: number | null;
  currency: string | null;
  timezoneName: string | null;
  /** Offset UTC em horas, truncado para inteiro (coluna é `integer`). */
  timezoneOffsetUtc: number | null;
  businessId: string | null;
  businessName: string | null;
}

/** Conta já persistida + estado de vínculo com o cliente. */
export interface ClientAdAccount extends DiscoveredAdAccount {
  isLinked: boolean;
  syncEnabled: boolean;
}

/** Rótulos dos códigos de `account_status` da Meta. */
export const AD_ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Não quitada",
  7: "Em análise de risco",
  8: "Aguardando pagamento",
  9: "Período de carência",
  100: "Fechamento pendente",
  101: "Fechada",
  201: "Ativa",
  202: "Fechada",
};

export function accountStatusLabel(status: number | null | undefined): string {
  if (status == null) return "Desconhecido";
  return AD_ACCOUNT_STATUS_LABEL[status] ?? `Código ${status}`;
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

/** Normaliza a forma do `act_<n>` (aceita id cru numérico também). */
export function normalizeAdAccountId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim();
  if (/^act_\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `act_${v}`;
  return null;
}

/** Um nó de `data[]` da resposta de `/me/adaccounts` -> DiscoveredAdAccount. */
export function parseAdAccountNode(node: unknown): DiscoveredAdAccount | null {
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

/**
 * Junta as páginas da descoberta e remove duplicatas por `adAccountId`
 * (mantém a primeira ocorrência). Nós inválidos são descartados —
 * NUNCA inventamos conta.
 */
export function mergeAdAccountPages(
  pages: unknown[][],
): DiscoveredAdAccount[] {
  const seen = new Set<string>();
  const out: DiscoveredAdAccount[] = [];
  for (const page of pages) {
    if (!Array.isArray(page)) continue;
    for (const node of page) {
      const parsed = parseAdAccountNode(node);
      if (!parsed || seen.has(parsed.adAccountId)) continue;
      seen.add(parsed.adAccountId);
      out.push(parsed);
    }
  }
  return out;
}
