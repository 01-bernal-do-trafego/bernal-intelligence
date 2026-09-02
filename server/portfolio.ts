import { eachDay } from "@/lib/date-range";
import { compareMetric, type Comparison } from "@/lib/comparison";
import { getMockDataset } from "@/lib/mock/dataset";
import type { ClientStatus, PortfolioAlert, TimePoint } from "@/types/domain";
import type { PeriodPreset } from "@/lib/date-range";
import { countActiveClients, listClients } from "./clients";
import { resolveRequestedPeriod } from "./period";
import { aggregate, dailyTotals, withinRange } from "./mock-helpers";

/** KPIs financeiros da carteira — MOCKADOS até a integração com a Meta Ads. */
export interface PortfolioFinancials {
  spend: Comparison;
  results: Comparison;
  costPerResult: Comparison;
}

export interface PortfolioClientRow {
  id: string;
  name: string;
  internalName: string | null;
  status: ClientStatus;
}

export interface SeriesPair {
  current: TimePoint[];
  previous: TimePoint[] | null;
}

export interface PortfolioOverview {
  preset: PeriodPreset;
  compare: boolean;
  range: { start: string; end: string };
  previous: { start: string; end: string };
  /** Contagem REAL de clientes com status "active". */
  activeClientsCount: number;
  /** Clientes REAIS (identidade apenas). */
  clients: PortfolioClientRow[];
  /** MOCK. */
  financials: PortfolioFinancials;
  /** MOCK. */
  spendSeries: SeriesPair;
  /** Sinaliza para a UI que financeiro/gráfico/alertas ainda são demo. */
  financialsAreMock: true;
}

export async function getPortfolioOverview(
  preset?: PeriodPreset,
  compare = false,
): Promise<PortfolioOverview> {
  const resolved = resolveRequestedPeriod(preset, compare);
  const { range, previous } = resolved;

  // ---- REAL (Supabase) --------------------------------------------------
  const [activeClientsCount, realClients] = await Promise.all([
    countActiveClients(),
    listClients({}),
  ]);
  const clients: PortfolioClientRow[] = realClients
    .filter((c) => c.status !== "archived")
    .map((c) => ({
      id: c.id,
      name: c.name,
      internalName: c.internalName,
      status: c.status,
    }));

  // ---- MOCK: financeiro da carteira, sai na integração Meta Ads --------
  const { dailyMetrics } = getMockDataset();
  const currentRows = withinRange(dailyMetrics, range);
  const previousRows = withinRange(dailyMetrics, previous);
  const cur = aggregate(currentRows);
  const prev = aggregate(previousRows);

  const financials: PortfolioFinancials = {
    spend: compareMetric(cur.spend, prev.spend, "neutral"),
    results: compareMetric(cur.results, prev.results, "higher_is_better"),
    costPerResult: compareMetric(cur.cpr, prev.cpr, "lower_is_better"),
  };

  const spendCurrent: TimePoint[] = dailyTotals(currentRows, eachDay(range)).map(
    (t) => ({ date: t.date, value: t.spend }),
  );
  const spendPrevious: TimePoint[] | null = compare
    ? dailyTotals(previousRows, eachDay(previous)).map((t) => ({
        date: t.date,
        value: t.spend,
      }))
    : null;
  // --------------------------------------------------------------------------

  return {
    preset: resolved.preset,
    compare,
    range,
    previous,
    activeClientsCount,
    clients,
    financials,
    spendSeries: { current: spendCurrent, previous: spendPrevious },
    financialsAreMock: true,
  };
}

/**
 * Alertas da Home. MOCKADOS — a detecção real virá em fase futura junto com
 * a integração de dados. Não vinculados aos clientes reais.
 */
export function getPortfolioAlerts(): PortfolioAlert[] {
  return [
    {
      id: "alert-1",
      kind: "critical",
      clientName: "Atacado do Chinelo",
      title: "Custo por resultado 34% acima da meta",
      description:
        "O CPR dos últimos 3 dias subiu de R$ 22 para R$ 30. A campanha de prospecção fria está puxando a média da conta.",
    },
    {
      id: "alert-2",
      kind: "warning",
      clientName: "Oversized Store",
      title: "Ritmo de orçamento adiantado",
      description:
        "78% do orçamento mensal consumido com 61% do mês decorrido. No ritmo atual, a verba se esgota ~4 dias antes do fim do mês.",
    },
    {
      id: "alert-3",
      kind: "opportunity",
      clientName: "Uniforte",
      title: "Espaço para escalar o Retargeting 7d",
      description:
        "CPR 28% abaixo da média da conta e frequência ainda baixa. Há margem para aumentar a verba diária em ~20%.",
    },
  ];
}
