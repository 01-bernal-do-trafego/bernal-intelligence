import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AVAILABLE_CHART_METRICS,
  CARD_CATALOG,
  CHART_METRIC_CATALOG,
  DEFAULT_DASHBOARD_CONFIG,
  MAX_CHARTS,
  METRIC_BEHAVIORS,
  REQUIRED_TABLE_COLUMN,
  RESULT_METRIC_OPTIONS,
  RESULT_METRIC_TYPE_LABEL,
  RESULT_METRIC_TYPES,
  TABLE_COLUMN_CATALOG,
  VISUALIZATION_CATALOG,
  addChart,
  catalogLabel,
  changeChartMetric,
  chartMetricLabel,
  compatibleVisualizations,
  dedupeResultDuplicates,
  defaultChartTitle,
  enabledKeys,
  isChartCombinationValid,
  moveItem,
  newChartConfig,
  parseDashboardConfig,
  removeChart,
  resultEquivalentKeys,
  resultMetricTypeLabel,
  sanitizeDashboardConfigInput,
  toggleItem,
  updateChart,
  visualizationLabel,
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
  it("FEATURE 02A: métricas ainda NÃO suportadas (02B — exigem novo campo da Graph API) ficam ausentes/requiresMeta", () => {
    // vídeo avançado (3s dedicada, ThruPlay, percentuais) exige ampliar a
    // coleta da Meta — fora do escopo desta rodada.
    const future = ["video_3s_views", "video_thruplays", "video_avg_time_watched", "hook_rate", "thruplay_rate"];
    for (const key of future) {
      expect(CHART_METRIC_CATALOG.find((m) => m.key === key), key).toBeUndefined();
    }
    // FEATURE 02A: pipeline já suportava — agora liberadas, sem requiresMeta.
    for (const key of [
      "messaging_conversations_started",
      "cost_per_conversation",
      "messaging_contacts_total",
      "messaging_contacts_new",
      "results",
      "cost_per_result",
      "leads",
      "cpl",
      "purchases",
      "cpa",
      "revenue",
      "roas",
      "landing_page_views",
      "cost_per_landing_page_view",
      "add_to_cart",
      "cost_per_add_to_cart",
      "initiate_checkout",
      "cost_per_initiate_checkout",
      "inline_link_clicks",
      "ctr_link",
      "cpc_link",
      "post_engagement",
      "post_reactions",
      "post_comments",
      "post_saves",
      "video_views",
    ]) {
      expect(CHART_METRIC_CATALOG.find((m) => m.key === key)?.requiresMeta, key).toBeFalsy();
    }
    // `conversations` genérico (alias) e `post` (compartilhamentos, semântica
    // não confirmada nesta rodada) continuam fora da seleção visual:
    expect(CHART_METRIC_CATALOG.find((m) => m.key === "conversations")).toBeUndefined();
    expect(CHART_METRIC_CATALOG.some((m) => m.label.toLowerCase().includes("compartilhamento"))).toBe(false);
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
    expect(isChartCombinationValid("video_3s_views", "line")).toBe(false); // sem fonte (02B)
    expect(isChartCombinationValid("desconhecida", "line")).toBe(false);
    expect(isChartCombinationValid("spend", "area")).toBe(true);
    expect(isChartCombinationValid("purchases", "line")).toBe(true); // FEATURE 02A: liberada
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
    // FEATURE 02A: "roas" foi liberada — usa um id genuinamente sem fonte
    // ainda (02B, vídeo avançado) para este caso.
    expect(changeChartMetric(charts, charts[0].id, "video_3s_views")).toBe(charts);
  });

  it("FEATURE 02A: trocar para roas/purchases agora é ACEITO (métricas liberadas)", () => {
    const charts = [newChartConfig("spend")];
    const next = changeChartMetric(charts, charts[0].id, "roas");
    expect(next[0].metric).toBe("roas");
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

  it("rejeita métrica que depende da Meta (02B — vídeo avançado)", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "video_3s_views", visualization: "line", title: "3s", enabled: true }]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("FEATURE 02A: aceita gráfico de ROAS (métrica liberada)", () => {
    expect(
      sanitizeDashboardConfigInput(
        withCharts([{ id: "a", metric: "roas", visualization: "line", title: "ROAS", enabled: true }]),
      ),
    ).toMatchObject({ ok: true });
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

/* ============ Resultado principal no editor (seção própria) ============ */

describe("Resultado principal — select amigável do editor", () => {
  const byLabel = new Map(RESULT_METRIC_OPTIONS.map((o) => [o.label, o.value]));

  it("as opções incluem pelo menos as métricas pedidas nesta fase", () => {
    for (const label of [
      "Conversas iniciadas",
      "Total de contatos",
      "Novos contatos",
      "Leads",
      "Compras",
      "Cadastros",
      "Agendamentos",
    ]) {
      expect(byLabel.has(label), label).toBe(true);
    }
  });

  it("selecionar um rótulo salva o id técnico correspondente", () => {
    expect(byLabel.get("Conversas iniciadas")).toBe("messaging_conversations_started");
    expect(byLabel.get("Total de contatos")).toBe("messaging_contacts_total");
    expect(byLabel.get("Novos contatos")).toBe("messaging_contacts_new");
    expect(byLabel.get("Leads")).toBe("leads");
    expect(byLabel.get("Compras")).toBe("purchases");
    expect(byLabel.get("Cadastros")).toBe("registrations");
    expect(byLabel.get("Agendamentos")).toBe("appointments");
  });

  it("toda opção tem value = ResultMetricType válido e label != id", () => {
    const valid = new Set(RESULT_METRIC_TYPES);
    for (const o of RESULT_METRIC_OPTIONS) {
      expect(valid.has(o.value), o.value).toBe(true);
      expect(o.label).not.toBe(o.value);
      expect(o.label, o.value).not.toMatch(/_/); // nada de snake_case visível
    }
  });

  it("lista CURADA: subconjunto válido, sem `conversations` (dup) nem `custom`", () => {
    const valid = new Set(RESULT_METRIC_TYPES);
    const values = RESULT_METRIC_OPTIONS.map((o) => o.value);
    for (const v of values) expect(valid.has(v)).toBe(true);
    expect(values).not.toContain("conversations");
    expect(values).not.toContain("custom");
    // o legado `conversations` é migrado, então nunca chega a precisar de opção
    expect(parseDashboardConfig({ result_metric: { type: "conversations" } }).resultMetric.type).toBe(
      "messaging_conversations_started",
    );
  });

  it("primeira versão prioriza mensageria (ordem de exibição)", () => {
    expect(RESULT_METRIC_OPTIONS.slice(0, 3).map((o) => o.value)).toEqual([
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
    ]);
  });

  it("editor CARREGA o result_metric atual do cliente", () => {
    for (const type of [
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
      "leads",
    ] as const) {
      const parsed = parseDashboardConfig({ result_metric: { type } });
      expect(parsed.resultMetric.type).toBe(type);
    }
  });

  it("result_metric inválido/desconhecido cai em `results` (nunca id cru)", () => {
    const parsed = parseDashboardConfig({ result_metric: { type: "xpto_123" } });
    expect(parsed.resultMetric.type).toBe("results");
    expect(parsed.resultMetric.resultLabel).toBe("Resultados");
  });

  it("salvar persiste o type escolhido em dashboard_configs (roundtrip)", () => {
    for (const type of [
      "messaging_conversations_started",
      "messaging_contacts_total",
      "messaging_contacts_new",
    ] as const) {
      const input = baseConfig();
      input.resultMetric = {
        type,
        resultLabel: RESULT_METRIC_TYPE_LABEL[type],
        costLabel: "Custo",
        behavior: "higher_is_better",
      };
      const out = sanitizeDashboardConfigInput(input);
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.value.resultMetric.type).toBe(type);
        // é exatamente o objeto que a server action grava
        expect(out.value).toHaveProperty("layout");
        expect(Object.keys(out.value).sort()).toEqual(["layout", "resultMetric"]);
      }
    }
  });

  it("Atacado do Chinelo: Conversas iniciadas ⇒ results = messaging_conversations_started", () => {
    // seleção pela interface — o valor persistido é o id técnico.
    expect(byLabel.get("Conversas iniciadas")).toBe("messaging_conversations_started");
  });

  it("trocar o result_metric NÃO dispara sincronização (server action)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../app/(app)/clients/actions.ts", import.meta.url)),
      "utf8",
    );
    // saveDashboardConfig só toca `dashboard_configs`; nada de sync/Meta.
    const body = src.slice(src.indexOf("export async function saveDashboardConfig"));
    expect(body).toContain('.from("dashboard_configs")');
    expect(body).not.toMatch(/meta-sync|meta-function|syncMeta|callMetaFunction|insights/i);
  });
});

/* ============ rótulos amigáveis — nenhum id técnico visível ============ */

describe("labels amigáveis (IDs internos nunca viram rótulo)", () => {
  const TECH_IDS = [
    "messaging_conversations_started",
    "messaging_contacts_total",
    "messaging_contacts_new",
    "cost_per_conversation",
    "cost_per_result",
  ];

  it("resultMetricTypeLabel traduz e nunca devolve o id", () => {
    expect(resultMetricTypeLabel("messaging_conversations_started")).toBe(
      "Conversas iniciadas",
    );
    expect(resultMetricTypeLabel("messaging_contacts_total")).toBe("Total de contatos");
    expect(resultMetricTypeLabel("messaging_contacts_new")).toBe("Novos contatos");
    // legado: representa exatamente "Conversas iniciadas" (sem dup visual)
    expect(resultMetricTypeLabel("conversations")).toBe("Conversas iniciadas");
    expect(resultMetricTypeLabel("results")).toBe("Resultados");
    // desconhecido -> rótulo genérico, jamais o id
    expect(resultMetricTypeLabel("algo_interno")).toBe("Resultados");
  });

  it("catálogos de card/gráfico/coluna têm rótulos amigáveis para métricas de conversão", () => {
    expect(catalogLabel(CARD_CATALOG, "messaging_conversations_started")).toBe("Conversas iniciadas");
    expect(catalogLabel(CARD_CATALOG, "cost_per_conversation")).toBe("Custo por conversa iniciada");
    expect(catalogLabel(CARD_CATALOG, "messaging_contacts_total")).toBe("Total de contatos");
    expect(catalogLabel(CARD_CATALOG, "messaging_contacts_new")).toBe("Novos contatos");
    expect(catalogLabel(CARD_CATALOG, "results")).toBe("Resultados");
    expect(catalogLabel(CARD_CATALOG, "cost_per_result")).toBe("Custo por resultado");
    expect(chartMetricLabel("messaging_conversations_started")).toBe("Conversas iniciadas");
    expect(catalogLabel(TABLE_COLUMN_CATALOG, "cost_per_conversation")).toBe("Custo por conversa iniciada");
    // `conversations` genérico não é chave visual de nenhum catálogo:
    expect(CARD_CATALOG.some((c) => c.key === "conversations")).toBe(false);
    expect(CHART_METRIC_CATALOG.some((c) => c.key === "conversations")).toBe(false);
  });

  it("nenhum rótulo de catálogo contém `_` ou é igual à sua key", () => {
    for (const entry of [...CARD_CATALOG, ...TABLE_COLUMN_CATALOG, ...CHART_METRIC_CATALOG]) {
      expect(entry.label, entry.key).not.toBe(entry.key);
      expect(entry.label, entry.key).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
    }
    for (const label of Object.values(RESULT_METRIC_TYPE_LABEL)) {
      expect(label).not.toMatch(/_/);
    }
  });

  it("fallback de rótulo desconhecido é genérico, nunca o id recebido", () => {
    for (const id of TECH_IDS) {
      expect(catalogLabel([], id)).not.toBe(id);
      expect(catalogLabel([], id)).toBe("Métrica");
    }
    expect(chartMetricLabel("__inexistente__")).toBe("Métrica");
    expect(visualizationLabel("__inexistente__")).toBe("Gráfico");
  });
});

/* ====== FEATURE 02A — catálogo único derivado do Registry ====== */

/** Liberadas nesta rodada — pipeline já suportava, só faltava expor. */
const RELEASED = [
  "results",
  "cost_per_result",
  "messaging_conversations_started",
  "cost_per_conversation",
  "messaging_contacts_total",
  "messaging_contacts_new",
  "leads",
  "cpl",
  "purchases",
  "cpa",
  "revenue",
  "roas",
  "landing_page_views",
  "cost_per_landing_page_view",
  "add_to_cart",
  "cost_per_add_to_cart",
  "initiate_checkout",
  "cost_per_initiate_checkout",
  "inline_link_clicks",
  "ctr_link",
  "cpc_link",
  "post_engagement",
  "post_reactions",
  "post_comments",
  "post_saves",
] as const;
/** Ficam para FEATURE 02B — exigem ampliar a coleta (novos campos da Graph API). */
const STILL_BLOCKED = [
  "video_3s_views",
  "video_thruplays",
  "video_avg_time_watched",
  "hook_rate",
  "thruplay_rate",
] as const;
/** Card/coluna-only (sem tabela nesta rodada — fora do pedido explícito). */
const CARD_CHART_ONLY = ["registrations", "appointments", "video_views", "cost_per_video_view"] as const;

describe("FEATURE 02A — catálogo único (Registry -> card/chart/table)", () => {
  it("métricas liberadas são selecionáveis como card (sem requiresMeta)", () => {
    for (const key of RELEASED) {
      const card = CARD_CATALOG.find((c) => c.key === key);
      expect(card, `card ${key}`).toBeDefined();
      expect(card?.requiresMeta, `card ${key}`).toBeFalsy();
    }
  });

  it("métricas liberadas são selecionáveis como gráfico (com seriesKey)", () => {
    for (const key of RELEASED) {
      const chart = CHART_METRIC_CATALOG.find((c) => c.key === key);
      expect(chart, `chart ${key}`).toBeDefined();
      expect(chart?.requiresMeta, `chart ${key}`).toBeFalsy();
      expect(chart?.seriesKey, `seriesKey ${key}`).toBeTruthy();
    }
  });

  it("métricas liberadas são colunas configuráveis da tabela", () => {
    for (const key of RELEASED) {
      expect(TABLE_COLUMN_CATALOG.some((c) => c.key === key), key).toBe(true);
    }
  });

  it("card/chart-only (sem tabela nesta rodada): card+chart sim, tabela não", () => {
    for (const key of CARD_CHART_ONLY) {
      expect(CARD_CATALOG.some((c) => c.key === key), `card ${key}`).toBe(true);
      expect(CHART_METRIC_CATALOG.some((c) => c.key === key), `chart ${key}`).toBe(true);
      expect(TABLE_COLUMN_CATALOG.some((c) => c.key === key), `table ${key}`).toBe(false);
    }
  });

  it("vídeo avançado (02B) segue ausente dos 3 catálogos — não é requiresMeta, é INEXISTENTE nesta fase", () => {
    for (const key of STILL_BLOCKED) {
      expect(CARD_CATALOG.some((c) => c.key === key), `card ${key}`).toBe(false);
      expect(CHART_METRIC_CATALOG.some((c) => c.key === key), `chart ${key}`).toBe(false);
      expect(TABLE_COLUMN_CATALOG.some((c) => c.key === key), `table ${key}`).toBe(false);
    }
  });

  it("Compartilhamentos NÃO é uma opção (action_type=post não confirmado semanticamente nesta rodada)", () => {
    for (const catalog of [CARD_CATALOG, CHART_METRIC_CATALOG, TABLE_COLUMN_CATALOG]) {
      expect(catalog.some((c) => c.label.toLowerCase().includes("compartilhamento"))).toBe(false);
    }
  });

  it("reach/frequência ganham coluna de tabela nesta rodada (antes só card+chart)", () => {
    expect(TABLE_COLUMN_CATALOG.some((c) => c.key === "reach")).toBe(true);
    expect(TABLE_COLUMN_CATALOG.some((c) => c.key === "frequency")).toBe(true);
  });

  it("ativar um card de qualquer métrica liberada é ACEITO no save", () => {
    for (const key of ["leads", "purchases", "roas", "landing_page_views", "post_engagement"]) {
      const input = baseConfig();
      input.layout.cards = [
        ...input.layout.cards.filter((c) => c.key !== key),
        { key, enabled: true },
      ];
      expect(sanitizeDashboardConfigInput(input), key).toMatchObject({ ok: true });
    }
  });

  it("adicionar gráfico temporal de conversas iniciadas é ACEITO", () => {
    const input = baseConfig();
    input.layout.charts = [
      {
        id: "c_conv",
        metric: "messaging_conversations_started",
        visualization: "area",
        title: "Conversas iniciadas ao longo do tempo",
        enabled: true,
      },
    ];
    expect(sanitizeDashboardConfigInput(input).ok).toBe(true);
  });

  it("ativar um card de vídeo avançado (02B) continua sendo rejeitado", () => {
    const input = baseConfig();
    input.layout.cards = [
      ...input.layout.cards.filter((c) => c.key !== "video_3s_views"),
      { key: "video_3s_views", enabled: true },
    ];
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("adicionar gráfico de ThruPlay (02B) continua sendo rejeitado", () => {
    const input = baseConfig();
    input.layout.charts = [
      { id: "c_tp", metric: "video_thruplays", visualization: "area", title: "ThruPlay", enabled: true },
    ];
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("messaging_* continua selecionável como Resultado principal", () => {
    const values = new Set(RESULT_METRIC_OPTIONS.map((o) => o.value));
    expect(values.has("messaging_conversations_started")).toBe(true);
    expect(values.has("messaging_contacts_total")).toBe(true);
    expect(values.has("messaging_contacts_new")).toBe(true);
  });

  it("nenhuma métrica precisa ser adicionada manualmente em mais de 1 catálogo: toda métrica card-eligible tem key coerente com chart/table", () => {
    // prova estrutural de que os 3 catálogos vêm da MESMA fonte: toda key de
    // CARD_CATALOG que também está em TABLE_COLUMN_CATALOG tem o MESMO label.
    for (const card of CARD_CATALOG) {
      const col = TABLE_COLUMN_CATALOG.find((c) => c.key === card.key);
      if (col) expect(col.label, card.key).toBe(card.label);
    }
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

/* ================= FEATURE 02A — catálogo único: propriedades estruturais ================= */

describe("FEATURE 02A — catálogos derivados do Registry: propriedades estruturais", () => {
  it("IDs únicos dentro de cada catálogo (nenhuma métrica duplicada manualmente)", () => {
    for (const catalog of [CARD_CATALOG, CHART_METRIC_CATALOG, TABLE_COLUMN_CATALOG]) {
      const keys = catalog.map((c) => c.key);
      expect(new Set(keys).size, `catálogo com ${keys.length} entradas`).toBe(keys.length);
    }
  });

  it("alias spend/investment preservado: card usa 'investment', gráfico usa 'spend' — mesmo label", () => {
    const card = CARD_CATALOG.find((c) => c.key === "investment");
    const chart = CHART_METRIC_CATALOG.find((c) => c.key === "spend");
    expect(card).toBeDefined();
    expect(chart).toBeDefined();
    expect(card?.label).toBe(chart?.label);
    expect(CARD_CATALOG.some((c) => c.key === "spend")).toBe(false);
    expect(CHART_METRIC_CATALOG.some((c) => c.key === "investment")).toBe(false);
  });

  it("total de métricas card-eligible cresceu com FEATURE 02A (mais que os 18 antigos)", () => {
    expect(CARD_CATALOG.length).toBeGreaterThan(18);
    expect(CHART_METRIC_CATALOG.length).toBeGreaterThan(18);
  });

  it("nenhum catálogo tem requiresMeta=true sobrando de métrica liberada nesta rodada", () => {
    for (const catalog of [CARD_CATALOG, CHART_METRIC_CATALOG]) {
      const stillGated = catalog.filter((c) => c.requiresMeta);
      // só o que sobrar deve ser 02B (nem deveria aparecer — ver teste acima
      // "vídeo avançado... segue ausente"); ou seja, hoje é sempre vazio.
      expect(stillGated).toEqual([]);
    }
  });
});

/* ================= FEATURE 02A — dedupeResultDuplicates / resultEquivalentKeys ================= */

describe("FEATURE 02A — dedupeResultDuplicates: Resultados vs métrica concreta", () => {
  it("result=messaging_conversations_started + ambos habilitados -> remove o card concreto duplicado", () => {
    const keys = [
      "investment",
      "results",
      "cost_per_result",
      "messaging_conversations_started",
      "cost_per_conversation",
    ];
    const out = dedupeResultDuplicates(keys, "messaging_conversations_started");
    expect(out).toEqual(["investment", "results", "cost_per_result"]);
  });

  it("result=leads + ambos habilitados -> remove leads/cpl duplicados", () => {
    const keys = ["results", "cost_per_result", "leads", "cpl", "reach"];
    const out = dedupeResultDuplicates(keys, "leads");
    expect(out).toEqual(["results", "cost_per_result", "reach"]);
  });

  it("result=purchases + ambos habilitados -> remove purchases/cpa duplicados", () => {
    const keys = ["results", "cost_per_result", "purchases", "cpa"];
    const out = dedupeResultDuplicates(keys, "purchases");
    expect(out).toEqual(["results", "cost_per_result"]);
  });

  it("'results' NÃO habilitado -> métrica concreta aparece normalmente (nada a deduplicar)", () => {
    const keys = ["investment", "leads", "cpl"];
    expect(dedupeResultDuplicates(keys, "leads")).toEqual(keys);
  });

  it("só 'results' habilitado (sem cost_per_result) -> remove só o valor, mantém o custo concreto", () => {
    const keys = ["results", "leads", "cpl"];
    expect(dedupeResultDuplicates(keys, "leads")).toEqual(["results", "cpl"]);
  });

  it("config antiga duplicada (ambos habilitados) normaliza em leitura — sem exceção, sem migration", () => {
    for (const resultType of [
      "leads",
      "purchases",
      "messaging_conversations_started",
      "conversations",
      "messaging_contacts_total",
      "messaging_contacts_new",
      "registrations",
      "appointments",
    ] as const) {
      // uma "config antiga" com TODOS os cards do catálogo habilitados
      // simultaneamente (o pior caso de duplicação possível) — chaves únicas,
      // como `enabledKeys()` sempre devolve na prática.
      const allKeys = CARD_CATALOG.map((c) => c.key);
      expect(() => dedupeResultDuplicates(allKeys, resultType)).not.toThrow();
      const out = dedupeResultDuplicates(allKeys, resultType);
      // "results" nunca aparece mais de 1x, e a concreta do tipo configurado
      // não sobrevive junto de "results" (a duplicação real que se busca evitar).
      expect(out.filter((k) => k === "results").length).toBeLessThanOrEqual(1);
      const equivalents = resultEquivalentKeys(resultType);
      if (out.includes("results")) {
        for (const eq of equivalents) expect(out).not.toContain(eq);
      }
    }
  });

  it("results/custom: nunca remove nada (sem concreta para deduplicar)", () => {
    const keys = ["results", "cost_per_result", "leads", "purchases"];
    expect(dedupeResultDuplicates(keys, "results")).toEqual(keys);
    expect(dedupeResultDuplicates(keys, "custom")).toEqual(keys);
  });
});

describe("FEATURE 02A — resultEquivalentKeys (aviso no editor)", () => {
  it("devolve a mesma dupla de dedupeResultDuplicates (fonte única — ver lib/meta/result-metric-resolve)", () => {
    expect(resultEquivalentKeys("leads")).toEqual(new Set(["leads", "cpl"]));
    expect(resultEquivalentKeys("purchases")).toEqual(new Set(["purchases", "cpa"]));
    expect(resultEquivalentKeys("messaging_conversations_started")).toEqual(
      new Set(["messaging_conversations_started", "cost_per_conversation"]),
    );
  });

  it("results/custom -> conjunto vazio", () => {
    expect(resultEquivalentKeys("results").size).toBe(0);
    expect(resultEquivalentKeys("custom").size).toBe(0);
  });
});
