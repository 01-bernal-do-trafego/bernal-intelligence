/**
 * DATA V2.3B — Historical Backfill Rollout. Cliente HTTP do
 * `meta-backfill-discovery` (Edge Function, V2.3B). `fetchImpl` é
 * injetável — testes usam um fake, nunca uma chamada de rede real.
 */

export interface DiscoveryConfig {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export interface DiscoveryFoundResult {
  status: "found";
  clientId: string;
  adAccountRef: string;
  metaAccountId: string;
  accountTimezone: string;
  accountCreatedDate: string;
  earliestDate: string;
  latestClosedDate: string;
  probesPerformed: number;
  strategy: string;
}
export interface DiscoveryNoHistoryResult {
  status: "no_history";
  clientId: string;
  adAccountRef: string;
  metaAccountId: string;
  accountTimezone: string;
  accountCreatedDate: string;
  earliestDate: null;
  latestClosedDate: string;
  probesPerformed: number;
  strategy: string;
}
export type DiscoveryResult = DiscoveryFoundResult | DiscoveryNoHistoryResult;

/** Descobre o intervalo histórico disponível para 1 conta. Lança se a Edge Function devolver erro (nunca engole silenciosamente). */
export async function discoverAccountHistory(
  config: DiscoveryConfig,
  args: { clientId: string; adAccountRef: string },
): Promise<DiscoveryResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(config.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-meta-backfill-discovery-secret": config.secret,
    },
    body: JSON.stringify(args),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`discovery falhou (${res.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed as DiscoveryResult;
}
