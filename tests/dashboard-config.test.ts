import { describe, expect, it } from "vitest";
import {
  AVAILABLE_CHART_METRICS,
  CARD_CATALOG,
  CHART_METRIC_CATALOG,
  DEFAULT_DASHBOARD_CONFIG,
  MAX_CHARTS,
  METRIC_BEHAVIORS,
  REQUIRED_TABLE_COLUMN,
  RESULT_METRIC_TYPES,
  TABLE_COLUMN_CATALOG,
  VISUALIZATION_CATALOG,
  addChart,
  changeChartMetric,
  compatibleVisualizations,
  defaultChartTitle,
  enabledKeys,
  isChartCombinationValid,
  moveItem,
  newChartConfig,
  parseDashboardConfig,
  removeChart,
  sanitizeDashboardConfigInput,
  toggleItem,
  updateChart,
  type ChartConfig,
  type DashboardConfigValue,
} from "@/lib/dashboard-config";

function baseConfig(): DashboardConfigValue {
  return structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;
}

/* ================= configuração padrão ================= */

describe("configuração padrão", () => {
  const cfg = DEFAULT_DASHBOARD_CONFIG;

  it("layout é version 2", () => {
    expect(cfg.layout.version).toBe(2);
  });

  it("cards e colunas padrão", () => {
    expect(enabledKeys(cfg.layout.cards)).toEqual([
      "investment",
      "results",
      "cost_per_result",
      "reach",
    ]);
    expect(enabledKeys(cfg.layout.tableColumns)[0]).toBe("campaign");
  });

  it("gráfico padrão: 3 gráficos genéricos (metric/visualization/title)", () => {
    expect(cfg.layout.charts).toHaveLength(3);
    expect(cfg.layout.charts.map((c) => c.metric)).toEqual([
      "results",
      "spend",
      "cost_per_result",
    ]);
    expect(cfg.layout.charts.map((c) => c.visualization)).toEqual([
      "area",
      "area",
      "line",
    ]);
    expect(cfg.layout.charts.every((c) => c.enabled && c.title.length > 0)).toBe(
      true,
    );
  });

  it("JSON vazio cai na configuração padrão segura (com migração)", () => {
    const parsed = parseDashboardConfig(null);
    expect(parsed.layout.version).toBe(2);
    expect(parsed.layout.charts.map((c) => c.metric)).toEqual([
      "results",
      "spend",
      "cost_per_result",
    ]);
  });
});

/* ================= migração v1 -> v2 ================= */

describe("migração v1 -> v2", () => {
  it("converte charts { key, enabled } do formato antigo", () => {
    const v1 = {
      result_metric: { type: "leads", resultLabel: "Leads", behavior: "higher_is_better" },
      layout: {
        version: 1,
        cards: [{ key: "investment", enabled: true }],
        charts: [
          { key: "investment_over_time", enabled: true },
          { key: "cost_per_result_over_time", enabled: true },
          { key: "ctr_over_time", enabled: false },
        ],
        tableColumns: [{ key: "campaign", enabled: true }],
      },
    };
    const parsed = parseDashboardConfig(v1);
    expect(parsed.layout.version).toBe(2);
    // só os que estavam visíveis, na mesma ordem
    expect(parsed.layout.charts.map((c) => c.metric)).toEqual([
      "spend",
      "cost_per_result",
    ]);
    expect(parsed.layout.charts[0].visualization).toBe("area");
    expect(parsed.layout.charts[1].visualization).toBe("line");
  });

  it("preserva o rótulo dinâmico da métrica principal na migração", () => {
    const v1 = {
      result_metric: { type: "purchases", resultLabel: "Compras", costLabel: "Custo por compra", behavior: "higher_is_better" },
      layout: {
        version: 1,
        cards: [{ key: "investment", enabled: true }],
        charts: [
          { key: "results_over_time", enabled: true },
          { key: "cost_per_result_over_time", enabled: true },
        ],
        tableColumns: [{ key: "campaign", enabled: true }],
      },
    };
    const parsed = parseDashboardConfig(v1);
    expect(parsed.layout.charts[0].title).toBe("Compras ao longo do tempo");
    expect(parsed.layout.charts[1].title).toBe("Custo por compra");
  });

  it("config sem version é tratada como v1 e migrada", () => {
    const parsed = parseDashboardConfig({
      layout: { charts: [{ key: "clicks_over_time", enabled: true }] },
    });
    expect(parsed.layout.charts).toEqual([
      expect.objectContaining({ metric: "clicks", visualization: "area" }),
    ]);
  });

  it("parse de config v2 já no formato novo é estável (round-trip)", () => {
    const v2 = baseConfig();
    v2.layout.charts = [
      { id: "c1", metric: "reach", visualization: "bar", title: "Alcance", enabled: true },
      { id: "c2", metric: "spend", visualization: "line", title: "Meu investimento", enabled: false },
    ];
    const once = parseDashboardConfig({
      result_metric: v2.resultMetric,
      layout: v2.layout,
    });
    const twice = parseDashboardConfig({
      result_metric: once.resultMetric,
      layout: once.layout,
    });
    expect(twice.layout.charts).toEqual(once.layout.charts);
    expect(once.layout.charts.map((c) => c.metric)).toEqual(["reach", "spend"]);
  });
});

/* ================= métricas e visualizações válidas ================= */

describe("catálogos de métrica e visualização", () => {
  it("métricas sem fonte ficam marcadas requiresMeta", () => {
    const future = ["purchases", "cpa", "revenue", "roas", "conversations", "cost_per_conversation"];
    for (const key of future) {
      expect(CHART_METRIC_CATALOG.find((m) => m.key === key)?.requiresMeta).toBe(true);
    }
    expect(AVAILABLE_CHART_METRICS.every((m) => !m.requiresMeta)).toBe(true);
  });

  it("visualizações implementadas: line, area, bar, horizontal_bar", () => {
    const impl = VISUALIZATION_CATALOG.filter((v) => v.implemented).map((v) => v.key);
    expect(impl).toEqual(["line", "area", "bar", "horizontal_bar"]);
    for (const key of ["donut", "pie", "stacked_bar", "combo"]) {
      expect(VISUALIZATION_CATALOG.find((v) => v.key === key)?.implemented).toBe(false);
    }
  });

  it("série temporal aceita linha, área e barras verticais", () => {
    expect(compatibleVisualizations("spend")).toEqual(["line", "area", "bar"]);
    expect(compatibleVisualizations("ctr")).toEqual(["line", "area", "bar"]);
  });

  it("barras horizontais não valem para série temporal", () => {
    expect(compatibleVisualizations("spend")).not.toContain("horizontal_bar");
    expect(isChartCombinationValid("spend", "horizontal_bar")).toBe(false);
  });

  it("combinações incompatíveis são rejeitadas", () => {
    expect(isChartCombinationValid("spend", "pie")).toBe(false); // não implementada
    expect(isChartCombinationValid("spend", "donut")).toBe(false); // nunca p/ série temporal
    expect(isChartCombinationValid("purchases", "line")).toBe(false); // sem fonte
    expect(isChartCombinationValid("desconhecida", "line")).toBe(false);
    expect(isChartCombinationValid("spend", "area")).toBe(true);
  });
});

/* ================= adicionar / remover / ordenar / título ================= */

describe("edição de gráficos", () => {
  it("adicionar gráfico gera um item válido com título padrão", () => {
    const next = addChart([], "spend");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      metric: "spend",
      visualization: "line",
      title: "Investimento ao longo do tempo",
      enabled: true,
    });
    expect(next[0].id).toMatch(/^chart_/);
  });

  it("não adiciona além do limite", () => {
    let charts: ChartConfig[] = [];
    for (let i = 0; i < MAX_CHARTS + 3; i++) charts = addChart(charts, "spend");
    expect(charts).toHaveLength(MAX_CHARTS);
  });

  it("remover gráfico tira só o item alvo", () => {
    const charts = [
      newChartConfig("spend"),
      newChartConfig("clicks"),
    ];
    const next = removeChart(charts, charts[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].metric).toBe("clicks");
  });

  it("alterar ordem via moveItem", () => {
    const a = newChartConfig("spend");
    const b = newChartConfig("clicks");
    const c = newChartConfig("reach");
    const list = [a, b, c];
    expect(moveItem(list, 0, 1).map((x) => x.metric)).toEqual([
      "clicks",
      "spend",
      "reach",
    ]);
    expect(moveItem(list, 2, 1)).toBe(list); // limite
  });

  it("editar título via updateChart", () => {
    const charts = [newChartConfig("spend")];
    const next = updateChart(charts, charts[0].id, { title: "Verba diária" });
    expect(next[0].title).toBe("Verba diária");
    expect(next[0].metric).toBe("spend");
  });

  it("trocar métrica ajusta visualização incompatível e título padrão", () => {
    const charts = [
      { id: "x", metric: "spend", visualization: "line", title: "Investimento ao longo do tempo", enabled: true } as ChartConfig,
    ];
    const next = changeChartMetric(charts, "x", "clicks");
    expect(next[0].metric).toBe("clicks");
    expect(next[0].visualization).toBe("line"); // ainda compatível
    expect(next[0].title).toBe("Cliques ao longo do tempo"); // título ainda era o padrão
  });

  it("trocar métrica preserva título customizado", () => {
    const charts = [
      { id: "x", metric: "spend", visualization: "area", title: "Meu gráfico", enabled: true } as ChartConfig,
    ];
    const next = changeChartMetric(charts, "x", "reach");
    expect(next[0].title).toBe("Meu gráfico");
  });

  it("trocar para métrica sem fonte é ignorado", () => {
    const charts = [newChartConfig("spend")];
    expect(changeChartMetric(charts, charts[0].id, "roas")).toBe(charts);
  });
});

/* ================= validação estrita (salvar) ================= */

describe("sanitizeDashboardConfigInput — gráficos", () => {
  function withCharts(charts: unknown): unknown {
    const cfg = baseConfig() as unknown as Record<string, unknown>;
    (cfg.layout as Record<string, unknown>).charts = charts;
    return cfg;
  }

  it("aceita uma configuração de gráficos válida e normaliza", () => {
    const res = sanitizeDashboardConfigInput(
      withCharts([
        { id: "a", metric: "spend", visualization: "bar", title: "Investimento", enabled: true },
        { id: "b", metric: "ctr", visualization: "line", title: "CTR diário", enabled: false },
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.layout.version).toBe(2);
      expect(res.value.layout.charts.map((c) => c.metric)).toEqual([
        "spend",
        "ctr",
      ]);
    }
  });

  it("rejeita métrica desconhecida", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "sales", visualization: "line", title: "X", enabled: true }]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita métrica que depende da Meta", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "roas", visualization: "line", title: "ROAS", enabled: true }]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita visualização não implementada", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "spend", visualization: "pie", title: "X", enabled: true }]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita combinação incompatível (horizontal_bar em série temporal)", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([
          { id: "a", metric: "spend", visualization: "horizontal_bar", title: "X", enabled: true },
        ]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita título vazio", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "spend", visualization: "line", title: "  ", enabled: true }]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita chave desconhecida no objeto do gráfico", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([
          { id: "a", metric: "spend", visualization: "line", title: "X", enabled: true, hack: 1 },
        ]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita ids duplicados", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([
          { id: "a", metric: "spend", visualization: "line", title: "X", enabled: true },
          { id: "a", metric: "reach", visualization: "line", title: "Y", enabled: true },
        ]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejeita quantidade excessiva de gráficos", () => {
    const many = Array.from({ length: MAX_CHARTS + 1 }, (_, i) => ({
      id: `c${i}`,
      metric: "spend",
      visualization: "line",
      title: "X",
      enabled: true,
    }));
    expect(sanitizeDashboardConfigInput(withCharts(many))).toMatchObject({
      ok: false,
    });
  });

  it("aceita lista vazia de gráficos (usuário removeu todos)", () => {
    expect(sanitizeDashboardConfigInput(withCharts([])).ok).toBe(true);
  });
});

/* ================= persistência (round-trip sanitize -> parse) ================= */

describe("persistência da configuração", () => {
  it("o que sanitize aprova volta idêntico pelo parse", () => {
    const input = withChartsOnBase([
      { id: "k1", metric: "reach", visualization: "bar", title: "Alcance", enabled: true },
      { id: "k2", metric: "cost_per_result", visualization: "line", title: "CPL", enabled: true },
      { id: "k3", metric: "clicks", visualization: "area", title: "Cliques", enabled: false },
    ]);
    const san = sanitizeDashboardConfigInput(input);
    expect(san.ok).toBe(true);
    if (!san.ok) return;
    const reread = parseDashboardConfig({
      result_metric: san.value.resultMetric,
      layout: san.value.layout,
    });
    expect(reread.layout.charts).toEqual(san.value.layout.charts);
  });
});

function withChartsOnBase(charts: unknown): unknown {
  const cfg = baseConfig() as unknown as Record<string, unknown>;
  (cfg.layout as Record<string, unknown>).charts = charts;
  return cfg;
}

/* ================= métrica principal + colunas (inalterado) ================= */

describe("métrica principal e colunas", () => {
  it("aceita todos os tipos e comportamentos", () => {
    for (const type of RESULT_METRIC_TYPES) {
      for (const behavior of METRIC_BEHAVIORS) {
        const input = baseConfig();
        input.resultMetric = {
          type,
          resultLabel: "Resultado X",
          costLabel: "Custo X",
          behavior,
        };
        expect(sanitizeDashboardConfigInput(input).ok).toBe(true);
      }
    }
  });

  it("rejeita comportamento inválido", () => {
    const input = baseConfig();
    input.resultMetric = { ...input.resultMetric, behavior: "always" as never };
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("coluna Campanha continua obrigatória", () => {
    const parsed = parseDashboardConfig({
      layout: {
        version: 2,
        tableColumns: [
          { key: "status", enabled: true },
          { key: "campaign", enabled: false },
        ],
      },
    });
    expect(parsed.layout.tableColumns[0]).toEqual({
      key: "campaign",
      enabled: true,
    });
  });

  it("card fora do catálogo é descartado no parse", () => {
    const parsed = parseDashboardConfig({
      layout: {
        version: 2,
        cards: [{ key: "hack", enabled: true }],
      },
    });
    expect(parsed.layout.cards.some((c) => c.key === "hack")).toBe(false);
  });

  it("toggleItem inverte só o card alvo", () => {
    const list = [
      { key: "a", enabled: true },
      { key: "b", enabled: false },
    ];
    expect(toggleItem(list, "b").find((i) => i.key === "b")?.enabled).toBe(true);
  });
});

/* ================= rejeição geral ================= */

describe("rejeição de valores inválidos", () => {
  it("entradas não-objeto", () => {
    expect(sanitizeDashboardConfigInput(null)).toMatchObject({ ok: false });
    expect(sanitizeDashboardConfigInput("x")).toMatchObject({ ok: false });
  });

  it("parse nunca lança", () => {
    expect(() =>
      parseDashboardConfig({
        result_metric: 7 as unknown,
        layout: [1, 2] as unknown,
      }),
    ).not.toThrow();
  });

  it("defaultChartTitle para métrica desconhecida", () => {
    expect(defaultChartTitle("nope")).toBe("Gráfico");
  });

  it("catálogo de cards inalterado", () => {
    expect(CARD_CATALOG.length).toBeGreaterThan(0);
    expect(TABLE_COLUMN_CATALOG[0].key).toBe(REQUIRED_TABLE_COLUMN);
  });
});
