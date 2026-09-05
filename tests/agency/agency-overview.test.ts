/**
 * Agregação da Agency Overview (lib/meta/agency-overview.ts) — módulo PURO.
 * Cobre: soma aditiva sem dupla contagem, CTR/CPC/CPM sobre totais (nunca
 * média), agrupamento de resultados por tipo canônico (nunca soma tipos
 * diferentes), custo/resultado agregado = SUM/SUM, cliente com múltiplas
 * contas soma 1 vez, "sem dado" ≠ "zero real", saúde da operação.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateDailySpend,
  agencyResultLabel,
  buildClientAggregate,
  combineAccountPeriods,
  computeAgencyTotals,
  computeCoverage,
  emptyAccountPeriod,
  groupResultsByType,
  hasMixedAgencyTimezones,
  summarizeHealth,
  topClientsBySpend,
  UNCONFIGURED_RESULT_LABEL,
  type AccountPeriodInput,
  type ClientAggregate,
} from "@/lib/meta/agency-overview";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import { computeMetric } from "@/lib/metrics/compute";
import { resolveCostPerResult, resolveResults } from "@/lib/meta/result-metric-resolve";

const acc = (o: Partial<AccountPeriodInput>): AccountPeriodInput => ({
  ...emptyAccountPeriod(),
  ...o,
});

describe("combineAccountPeriods — soma entre contas/dias", () => {
  it("soma spend/impressions/clicks aditivamente", () => {
    const out = combineAccountPeriods([
      acc({ spend: 100, impressions: 1000, clicks: 10 }),
      acc({ spend: 50, impressions: 500, clicks: 5 }),
    ]);
    expect(out).toMatchObject({ spend: 150, impressions: 1500, clicks: 15 });
  });
  it("null só quando TODAS as contas são null naquele campo (nunca vira 0 sozinho)", () => {
    const out = combineAccountPeriods([acc({ spend: null }), acc({ spend: null })]);
    expect(out.spend).toBeNull();
  });
  it("uma conta com dado + outra sem -> soma só a que tem (não é 'sem dado')", () => {
    const out = combineAccountPeriods([acc({ spend: 100 }), acc({ spend: null })]);
    expect(out.spend).toBe(100);
  });
  it("soma raw_actions/raw_action_values entre contas", () => {
    const out = combineAccountPeriods([
      acc({ rawActions: { leads: 3 } }),
      acc({ rawActions: { leads: 2, purchase: 1 } }),
    ]);
    expect(out.rawActions).toEqual({ leads: 5, purchase: 1 });
  });
  it("array vazio -> tudo null (nenhuma conta elegível)", () => {
    const out = combineAccountPeriods([]);
    expect(out.spend).toBeNull();
    expect(out.impressions).toBeNull();
  });
});

describe("buildClientAggregate — CTR/CPC/CPM sobre TOTAIS, nunca média", () => {
  it("calcula CTR/CPC/CPM dos totais brutos", () => {
    const out = buildClientAggregate({
      clientId: "c1",
      name: "Atacado do Chinelo",
      resultType: "messaging_conversations_started",
      period: acc({ spend: 1000, impressions: 100_000, clicks: 2000 }),
    });
    expect(out.ctr).toBeCloseTo((2000 / 100_000) * 100, 6);
    expect(out.cpc).toBeCloseTo(1000 / 2000, 6);
    expect(out.cpm).toBeCloseTo((1000 / 100_000) * 1000, 6);
  });

  it("sem dado no período (spend null) -> hasData=false, results/CPR null (nunca 0)", () => {
    const out = buildClientAggregate({
      clientId: "c1",
      name: "X",
      resultType: "leads",
      period: emptyAccountPeriod(),
    });
    expect(out.hasData).toBe(false);
    expect(out.spend).toBeNull();
    expect(out.results).toBeNull();
    expect(out.costPerResult).toBeNull();
  });

  it("resolve result_metric pela MESMA lógica do dashboard individual (raw_actions -> canônica)", () => {
    const out = buildClientAggregate({
      clientId: "c1",
      name: "Atacado",
      resultType: "messaging_conversations_started",
      period: acc({
        spend: 932,
        rawActions: { "onsite_conversion.messaging_conversation_started_7d": 620 },
      }),
    });
    expect(out.results).toBe(620);
    expect(out.costPerResult).toBeCloseTo(932 / 620, 6);
    expect(out.canonicalResultId).toBe("messaging_conversations_started");
  });

  it("resultType sem canônica (results/custom) -> canonicalResultId null, results null", () => {
    const out = buildClientAggregate({
      clientId: "c1",
      name: "X",
      resultType: "results",
      period: acc({ spend: 500 }),
    });
    expect(out.canonicalResultId).toBeNull();
    expect(out.results).toBeNull();
  });

  it("cliente com dado real mas ZERO eventos no período -> results null (não 0), spend real preservado", () => {
    const out = buildClientAggregate({
      clientId: "c1",
      name: "X",
      resultType: "leads",
      period: acc({ spend: 300, impressions: 1000, clicks: 10 }), // sem raw_actions
    });
    expect(out.hasData).toBe(true);
    expect(out.spend).toBe(300);
    expect(out.results).toBeNull();
  });
});

describe("computeAgencyTotals — soma entre clientes, recalcula CTR/CPC/CPM", () => {
  const client = (o: Partial<ClientAggregate>): ClientAggregate => ({
    clientId: "c",
    name: "C",
    resultType: "leads",
    resultLabel: "Leads",
    canonicalResultId: "leads",
    hasData: true,
    spend: 100,
    impressions: 10_000,
    clicks: 100,
    ctr: 1,
    cpc: 1,
    cpm: 10,
    results: 5,
    costPerResult: 20,
    ...o,
  });

  it("soma spend/impressions/clicks; CTR/CPC/CPM recalculados dos totais (nunca média dos individuais)", () => {
    const totals = computeAgencyTotals([
      client({ spend: 100, impressions: 10_000, clicks: 100 }), // ctr individual 1%
      client({ spend: 300, impressions: 100_000, clicks: 100 }), // ctr individual 0.1%
    ]);
    expect(totals.spend).toBe(400);
    expect(totals.impressions).toBe(110_000);
    expect(totals.clicks).toBe(200);
    // ctr correto do total: 200/110000*100 ≈ 0.1818% — NÃO a média (0.55%) dos dois CTRs individuais
    expect(totals.ctr).toBeCloseTo((200 / 110_000) * 100, 6);
    expect(totals.ctr).not.toBeCloseTo((1 + 0.1) / 2, 2);
  });

  it("cliente sem dado (hasData=false) não entra na soma", () => {
    const totals = computeAgencyTotals([
      client({ spend: 100 }),
      client({ hasData: false, spend: null, impressions: null, clicks: null }),
    ]);
    expect(totals.spend).toBe(100);
  });

  it("nenhum cliente com dado -> tudo null (nunca 0 disfarçado)", () => {
    const totals = computeAgencyTotals([client({ hasData: false, spend: null })]);
    expect(totals.spend).toBeNull();
    expect(totals.ctr).toBeNull();
  });
});

describe("groupResultsByType — nunca soma tipos diferentes", () => {
  const client = (o: Partial<ClientAggregate>): ClientAggregate => ({
    clientId: "c",
    name: "C",
    resultType: "leads",
    resultLabel: "Leads",
    canonicalResultId: "leads",
    hasData: true,
    spend: 100,
    impressions: null,
    clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    results: 10,
    costPerResult: 10,
    ...o,
  });

  it("clientes com o MESMO result_metric agregam num grupo só", () => {
    const groups = groupResultsByType([
      client({ clientId: "a", spend: 100, results: 10 }),
      client({ clientId: "b", spend: 200, results: 20 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ canonicalId: "leads", spend: 300, results: 30, clientCount: 2 });
  });

  it("tipos DIFERENTES formam grupos separados — nunca somados juntos", () => {
    const groups = groupResultsByType([
      client({ clientId: "a", canonicalResultId: "leads", resultType: "leads", spend: 100, results: 10 }),
      client({
        clientId: "b",
        canonicalResultId: "purchases",
        resultType: "purchases",
        spend: 3500,
        results: 84,
      }),
    ]);
    expect(groups).toHaveLength(2);
    const leads = groups.find((g) => g.canonicalId === "leads");
    const purchases = groups.find((g) => g.canonicalId === "purchases");
    expect(leads?.results).toBe(10);
    expect(purchases?.results).toBe(84);
    // nenhum grupo mistura os dois totais (ex.: 94 ou 3600 não devem aparecer)
    expect(groups.some((g) => g.results === 94)).toBe(false);
  });

  it("custo/resultado do grupo = SUM(spend)/SUM(results), NUNCA média dos individuais", () => {
    // A: spend 100, results 10 -> CPR individual 10. B: spend 900, results 10 -> CPR individual 90.
    // média ingênua seria 50; SUM/SUM correto = 1000/20 = 50 coincide aqui, então uso valores que discriminam:
    const groups = groupResultsByType([
      client({ clientId: "a", spend: 100, results: 20 }), // CPR individual 5
      client({ clientId: "b", spend: 900, results: 10 }), // CPR individual 90
    ]);
    // média ingênua dos CPRs = (5+90)/2 = 47.5 ; correto = SUM(1000)/SUM(30) = 33.33...
    expect(groups[0].costPerResult).toBeCloseTo(1000 / 30, 6);
    expect(groups[0].costPerResult).not.toBeCloseTo(47.5, 1);
  });

  it("results agregado = 0 -> costPerResult null (mostrar '—', nunca dividir por zero)", () => {
    const groups = groupResultsByType([client({ spend: 500, results: 0 })]);
    expect(groups[0].results).toBe(0);
    expect(groups[0].costPerResult).toBeNull();
  });

  it("cliente com resultType sem canônica (results/custom) fica de fora do agrupamento", () => {
    const groups = groupResultsByType([
      client({ canonicalResultId: null, resultType: "results" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("cliente sem dado no período (hasData=false) fica de fora do agrupamento", () => {
    const groups = groupResultsByType([client({ hasData: false, spend: null, results: null })]);
    expect(groups).toHaveLength(0);
  });

  it("cliente com dado real mas 0 eventos ainda soma o SPEND ao grupo (resultado 0, investimento real)", () => {
    const groups = groupResultsByType([
      client({ clientId: "a", spend: 100, results: 10 }),
      client({ clientId: "b", spend: 200, results: null }), // zero eventos, mas tinha spend
    ]);
    expect(groups[0].spend).toBe(300); // os 200 não somem
    expect(groups[0].results).toBe(10); // contribuição de b tratada como 0
  });
});

describe("topClientsBySpend", () => {
  const client = (id: string, spend: number | null, hasData = true): ClientAggregate => ({
    clientId: id,
    name: id,
    resultType: "leads",
    resultLabel: "Leads",
    canonicalResultId: "leads",
    hasData,
    spend,
    impressions: null,
    clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    results: null,
    costPerResult: null,
  });

  it("ordena do maior para o menor spend e respeita o limite", () => {
    const top = topClientsBySpend(
      [client("a", 100), client("b", 500), client("c", 300)],
      2,
    );
    expect(top.map((c) => c.clientId)).toEqual(["b", "c"]);
  });
  it("exclui clientes sem dado", () => {
    const top = topClientsBySpend([client("a", 100), client("b", null, false)]);
    expect(top.map((c) => c.clientId)).toEqual(["a"]);
  });
});

describe("aggregateDailySpend — série do gráfico agency-wide", () => {
  it("soma spend por data entre múltiplas contas/clientes", () => {
    const out = aggregateDailySpend([
      { date: "2026-09-01", spend: 100 },
      { date: "2026-09-01", spend: 50 },
      { date: "2026-09-02", spend: 20 },
    ]);
    expect(out).toEqual([
      { date: "2026-09-01", value: 150 },
      { date: "2026-09-02", value: 20 },
    ]);
  });
  it("ignora entradas null (não vira 0 no dia)", () => {
    const out = aggregateDailySpend([{ date: "2026-09-01", spend: null }]);
    expect(out).toEqual([]);
  });
});

describe("summarizeHealth", () => {
  it("classifica fresh/stale/never e detecta problemas", () => {
    const counts = summarizeHealth([
      { performanceStatus: "fresh", lastSyncStatus: "success", metaState: "connected" },
      { performanceStatus: "stale", lastSyncStatus: "success", metaState: "connected" },
      { performanceStatus: "never", lastSyncStatus: "never", metaState: "not_connected" },
      { performanceStatus: "fresh", lastSyncStatus: "failed", metaState: "connected" },
      { performanceStatus: "fresh", lastSyncStatus: "success", metaState: "reconnect" },
    ]);
    expect(counts.fresh).toBe(3);
    expect(counts.stale).toBe(1);
    expect(counts.never).toBe(1);
    expect(counts.lastSyncProblem).toBe(1);
    expect(counts.metaNeedsAttention).toBe(2); // not_connected + reconnect
    // atenção: stale(1) + never(1) + falha(1) + reconnect(1) = 4 (not_connected já contado por 'never')
    expect(counts.attentionCount).toBe(4);
  });

  it("cliente perfeito (fresh + success + connected) não conta como atenção", () => {
    const counts = summarizeHealth([
      { performanceStatus: "fresh", lastSyncStatus: "success", metaState: "connected" },
    ]);
    expect(counts.attentionCount).toBe(0);
  });
});

describe("RECONCILIAÇÃO — cliente de 1 conta bate com o dashboard individual", () => {
  // Mesmo formato de linha que meta_insights_periodic entrega (nível conta,
  // period_key do preset, attribution_window canônica) — tanto a Agency
  // Overview quanto o dashboard individual leem a MESMA linha para um
  // cliente de conta única.
  const periodicRow = {
    spend: 920.95,
    impressions: 62526,
    clicks: 3527,
    raw_actions: { "onsite_conversion.messaging_conversation_started_7d": 617 },
    raw_action_values: {},
  };

  it("CTR/CPC/CPM/Resultados/Custo-por-resultado idênticos ao cálculo do dashboard individual", () => {
    // caminho AGENCY OVERVIEW
    const agency = buildClientAggregate({
      clientId: "c1",
      name: "Atacado do Chinelo",
      resultType: "messaging_conversations_started",
      period: {
        spend: periodicRow.spend,
        impressions: periodicRow.impressions,
        clicks: periodicRow.clicks,
        rawActions: periodicRow.raw_actions,
        rawActionValues: periodicRow.raw_action_values,
      },
    });

    // caminho DASHBOARD INDIVIDUAL (mesmas peças que server/real-dashboard.ts usa)
    const individualTotals = conversionTotalsFromRow(periodicRow);
    const individual = {
      ctr: computeMetric("ctr", individualTotals),
      cpc: computeMetric("cpc", individualTotals),
      cpm: computeMetric("cpm", individualTotals),
      results: resolveResults(individualTotals, "messaging_conversations_started"),
      costPerResult: resolveCostPerResult(individualTotals, "messaging_conversations_started"),
    };

    expect(agency.spend).toBe(periodicRow.spend);
    expect(agency.ctr).toBe(individual.ctr);
    expect(agency.cpc).toBe(individual.cpc);
    expect(agency.cpm).toBe(individual.cpm);
    expect(agency.results).toBe(individual.results);
    expect(agency.results).toBe(617);
    expect(agency.costPerResult).toBe(individual.costPerResult);
    expect(agency.costPerResult).toBeCloseTo(920.95 / 617, 6);
  });

  it("único cliente com dado -> Investimento gerenciado da agência = spend dele", () => {
    const agency = buildClientAggregate({
      clientId: "c1",
      name: "Atacado do Chinelo",
      resultType: "messaging_conversations_started",
      period: {
        spend: periodicRow.spend,
        impressions: periodicRow.impressions,
        clicks: periodicRow.clicks,
        rawActions: periodicRow.raw_actions,
        rawActionValues: periodicRow.raw_action_values,
      },
    });
    const semDado = buildClientAggregate({
      clientId: "c2",
      name: "Cliente sem Meta",
      resultType: "results",
      period: emptyAccountPeriod(),
    });
    const totals = computeAgencyTotals([agency, semDado]);
    expect(totals.spend).toBe(agency.spend);
  });
});

describe("computeCoverage", () => {
  it("cobertura completa: todos com dado", () => {
    const client = (hasData: boolean): ClientAggregate => ({
      clientId: "c",
      name: "C",
      resultType: "leads",
      resultLabel: "Leads",
      canonicalResultId: "leads",
      hasData,
      spend: hasData ? 100 : null,
      impressions: null,
      clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      results: null,
      costPerResult: null,
    });
    expect(computeCoverage([client(true), client(true)])).toEqual({ withData: 2, total: 2 });
  });
  it("cobertura parcial: 6 de 10", () => {
    const client = (hasData: boolean): ClientAggregate => ({
      clientId: "c",
      name: "C",
      resultType: "leads",
      resultLabel: "Leads",
      canonicalResultId: "leads",
      hasData,
      spend: hasData ? 100 : null,
      impressions: null,
      clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      results: null,
      costPerResult: null,
    });
    const clients = [
      ...Array.from({ length: 6 }, () => client(true)),
      ...Array.from({ length: 4 }, () => client(false)),
    ];
    expect(computeCoverage(clients)).toEqual({ withData: 6, total: 10 });
  });
  it("nenhum dado -> 0 de N", () => {
    const client: ClientAggregate = {
      clientId: "c",
      name: "C",
      resultType: "leads",
      resultLabel: "Leads",
      canonicalResultId: "leads",
      hasData: false,
      spend: null,
      impressions: null,
      clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      results: null,
      costPerResult: null,
    };
    expect(computeCoverage([client, client])).toEqual({ withData: 0, total: 2 });
  });
});

describe("groupResultsByType — cobertura parcial no grupo", () => {
  const client = (o: Partial<ClientAggregate>): ClientAggregate => ({
    clientId: "c",
    name: "C",
    resultType: "leads",
    resultLabel: "Leads",
    canonicalResultId: "leads",
    hasData: true,
    spend: 100,
    impressions: null,
    clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    results: 10,
    costPerResult: 10,
    ...o,
  });

  it("2 configurados, só 1 com dado -> totalConfiguredCount=2, clientCount=1", () => {
    const groups = groupResultsByType([
      client({ clientId: "a", hasData: true, spend: 100, results: 10 }),
      client({ clientId: "b", hasData: false, spend: null, results: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ clientCount: 1, totalConfiguredCount: 2 });
  });

  it("todos com dado -> clientCount === totalConfiguredCount (sem nota de cobertura)", () => {
    const groups = groupResultsByType([
      client({ clientId: "a" }),
      client({ clientId: "b" }),
    ]);
    expect(groups[0].clientCount).toBe(groups[0].totalConfiguredCount);
  });
});

describe("hasMixedAgencyTimezones", () => {
  it("todas America/Sao_Paulo (ou null) -> false", () => {
    expect(hasMixedAgencyTimezones(["America/Sao_Paulo", "America/Sao_Paulo"])).toBe(false);
    expect(hasMixedAgencyTimezones([null, "America/Sao_Paulo", undefined])).toBe(false);
    expect(hasMixedAgencyTimezones([])).toBe(false);
  });
  it("alguma conta em outro fuso -> true", () => {
    expect(hasMixedAgencyTimezones(["America/Sao_Paulo", "America/New_York"])).toBe(true);
    expect(hasMixedAgencyTimezones(["Europe/Lisbon"])).toBe(true);
  });
});

describe("AccountPeriodInput — Agency Overview NÃO reconstrói reach/frequency", () => {
  it("combineAccountPeriods não produz campos de reach/frequency", () => {
    const out = combineAccountPeriods([
      { spend: 10, impressions: 100, clicks: 1, rawActions: {}, rawActionValues: {} },
    ]);
    expect(Object.keys(out).sort()).toEqual(
      ["clicks", "impressions", "rawActionValues", "rawActions", "spend"].sort(),
    );
    expect("reach" in out).toBe(false);
    expect("frequency" in out).toBe(false);
  });
});

describe("agencyResultLabel — Resultado principal por cliente", () => {
  it("tipo com canônica -> rótulo amigável do tipo", () => {
    expect(agencyResultLabel("leads", "leads", null)).toBe("Leads");
    expect(agencyResultLabel("purchases", "purchases", "qualquer")).toBe("Compras");
    expect(
      agencyResultLabel("messaging_conversations_started", "messaging_conversations_started", null),
    ).toBe("Conversas iniciadas");
  });
  it("tipo custom com rótulo PRÓPRIO -> usa o rótulo do config", () => {
    expect(agencyResultLabel("custom", null, "Vendas no balcão")).toBe("Vendas no balcão");
  });
  it("tipo custom/results com rótulo genérico 'Resultados' ou vazio -> 'Não configurado'", () => {
    expect(agencyResultLabel("custom", null, "Resultados")).toBe(UNCONFIGURED_RESULT_LABEL);
    expect(agencyResultLabel("results", null, "")).toBe(UNCONFIGURED_RESULT_LABEL);
    expect(agencyResultLabel("custom", null, null)).toBe(UNCONFIGURED_RESULT_LABEL);
    expect(agencyResultLabel("custom", null, undefined)).toBe(UNCONFIGURED_RESULT_LABEL);
    expect(UNCONFIGURED_RESULT_LABEL).toBe("Não configurado");
  });
  it("buildClientAggregate propaga o rótulo (Up Assessoria = custom + 'Resultados' -> Não configurado)", () => {
    const agg = buildClientAggregate({
      clientId: "up",
      name: "Up Assessoria",
      resultType: "custom",
      configuredResultLabel: "Resultados",
      period: emptyAccountPeriod(),
    });
    expect(agg.resultLabel).toBe("Não configurado");
    expect(agg.results).toBeNull();
  });
});

describe("aggregateDailySpend — missing day != zero real", () => {
  it("dia SEM linha não vira R$0 na série (só entram datas presentes)", () => {
    const out = aggregateDailySpend([
      { date: "2026-09-01", spend: 100 },
      { date: "2026-09-03", spend: 40 }, // 09-02 ausente de propósito
    ]);
    expect(out.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(out.some((p) => p.date === "2026-09-02")).toBe(false);
  });
  it("spend real = 0 CONTINUA 0 na série (zero real preservado)", () => {
    const out = aggregateDailySpend([
      { date: "2026-09-03", spend: 17.92 },
      { date: "2026-09-04", spend: 0 }, // dia real de gasto ~zero
    ]);
    const last = out.find((p) => p.date === "2026-09-04");
    expect(last).toBeDefined();
    expect(last?.value).toBe(0);
  });
  it("spend null (linha sem valor) NÃO entra como 0", () => {
    expect(aggregateDailySpend([{ date: "2026-09-04", spend: null }])).toEqual([]);
  });
});
