import { eachDay } from "@/lib/date-range";
import { compareMetric, type Comparison } from "@/lib/comparison";
import { safeDivide } from "@/lib/metrics";
import { getMockDataset } from "@/lib/mock/dataset";
import type {
  ClientStatus,
  MetaConnectionStatus,
  PortfolioAlert,
  TimePoint,
} from "@/types/domain";
import type { PeriodPreset } from "@/lib/date-range";
import { resolveRequestedPeriod } from "./period";
import { aggregate, dailyTotals, withinRange } from "./mock-helpers";

export interface PortfolioKpis {
  activeClients: Comparison;
  spend: Comparison;
  results: Comparison;
  costPerResult: Comparison;
}

export interface PortfolioClientRow {
  id: string;
  name: string;
  status: ClientStatus;
  metaStatus: MetaConnectionStatus;
  healthScore: number;
  spend: number;
  results: number;
  costPerResult: number;
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
  kpis: PortfolioKpis;
  spendSeries: SeriesPair;
  clients: PortfolioClientRow[];
}

export function getPortfolioOverview(
  preset?: PeriodPreset,
  compare = false,
): PortfolioOverview {
  const resolved = resolveRequestedPeriod(preset, compare);
  const { range, previous } = resolved;
  const { clients, dailyMetrics } = getMockDataset();

  const currentRows = withinRange(dailyMetrics, range);
  const previousRows = withinRange(dailyMetrics, previous);

  const cur = aggregate(currentRows);
  const prev = aggregate(previousRows);

  const activeCurrent = new Set(
    currentRows.filter((r) => r.spend > 0).map((r) => r.clientId),
  ).size;
  const activePrevious = new Set(
    previousRows.filter((r) => r.spend > 0).map((r) => r.clientId),
  ).size;

  const kpis: PortfolioKpis = {
    activeClients: compareMetric(activeCurrent, activePrevious, "higher_is_better"),
    spend: compareMetric(cur.spend, prev.spend, "neutral"),
    results: compareMetric(cur.results, prev.results, "higher_is_better"),
    costPerResult: compareMetric(cur.cpr, prev.cpr, "lower_is_better"),
  };

  const currentDays = eachDay(range);
  const spendCurrent: TimePoint[] = dailyTotals(currentRows, currentDays).map((t) => ({
    date: t.date,
    value: t.spend,
  }));

  let spendPrevious: TimePoint[] | null = null;
  if (compare) {
    const previousDays = eachDay(previous);
    spendPrevious = dailyTotals(previousRows, previousDays).map((t) => ({
      date: t.date,
      value: t.spend,
    }));
  }

  const clientRows: PortfolioClientRow[] = clients
    .filter((c) => c.status !== "archived")
    .map((client) => {
      const agg = aggregate(
        currentRows.filter((r) => r.clientId === client.id),
      );
      return {
        id: client.id,
        name: client.name,
        status: client.status,
        metaStatus: client.metaStatus,
        healthScore: client.healthScore,
        spend: agg.spend,
        results: agg.results,
        costPerResult: safeDivide(agg.spend, agg.results),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  return {
    preset: resolved.preset,
    compare,
    range,
    previous,
    kpis,
    spendSeries: { current: spendCurrent, previous: spendPrevious },
    clients: clientRows,
  };
}

/**
 * Alertas da Home. Nesta versão são exemplos fixos (mockados) — a lógica
 * real de detecção virá em fase futura.
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
