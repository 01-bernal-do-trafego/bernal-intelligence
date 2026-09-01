import { resolvePeriod } from "@/lib/date-range";
import { MOCK_TODAY, getMockDataset } from "@/lib/mock/dataset";
import type { AdAccount, Campaign, Client, ClientStatus } from "@/types/domain";
import { withinRange } from "./mock-helpers";

export interface ClientListItem extends Client {
  /** Investimento nos últimos 30 dias (para leitura rápida na lista). */
  spendLast30d: number;
}

export interface ListClientsOptions {
  search?: string;
  status?: ClientStatus | "all";
}

export function listClients(options: ListClientsOptions = {}): ClientListItem[] {
  const { search = "", status = "all" } = options;
  const { clients, dailyMetrics } = getMockDataset();
  const last30 = resolvePeriod("last_30d", MOCK_TODAY);
  const recentRows = withinRange(dailyMetrics, last30);

  const term = search.trim().toLowerCase();

  return clients
    .filter((client) => {
      if (status !== "all" && client.status !== status) return false;
      if (!term) return true;
      return (
        client.name.toLowerCase().includes(term) ||
        client.internalName.toLowerCase().includes(term)
      );
    })
    .map((client) => ({
      ...client,
      spendLast30d: recentRows
        .filter((r) => r.clientId === client.id)
        .reduce((sum, r) => sum + r.spend, 0),
    }));
}

export function getClientById(id: string): Client | null {
  return getMockDataset().clients.find((client) => client.id === id) ?? null;
}

export function getClientAccounts(clientId: string): AdAccount[] {
  return getMockDataset().accounts.filter((acc) => acc.clientId === clientId);
}

export function getClientCampaigns(
  clientId: string,
  accountId?: string,
): Campaign[] {
  return getMockDataset().campaigns.filter(
    (campaign) =>
      campaign.clientId === clientId &&
      (!accountId || accountId === "all" || campaign.accountId === accountId),
  );
}
