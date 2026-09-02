import { describe, expect, it } from "vitest";
import {
  CARD_CATALOG,
  CHART_CATALOG,
  DEFAULT_DASHBOARD_CONFIG,
  METRIC_BEHAVIORS,
  REQUIRED_TABLE_COLUMN,
  RESULT_METRIC_TYPES,
  TABLE_COLUMN_CATALOG,
  enabledKeys,
  moveItem,
  parseDashboardConfig,
  sanitizeDashboardConfigInput,
  toggleItem,
  type DashboardConfigValue,
} from "@/lib/dashboard-config";

/* ---------- configuração padrão ---------- */

describe("configuração padrão", () => {
  const cfg = DEFAULT_DASHBOARD_CONFIG;

  it("cards padrão são investimento/resultados/custo/alcance, nessa ordem", () => {
    expect(enabledKeys(cfg.layout.cards)).toEqual([
      "investment",
      "results",
      "cost_per_result",
      "reach",
    ]);
  });

  it("gráficos padrão", () => {
    expect(enabledKeys(cfg.layout.charts)).toEqual([
      "results_over_time",
      "investment_over_time",
      "cost_per_result_over_time",
    ]);
  });

  it("colunas padrão incluem Campanha e Status", () => {
    const cols = enabledKeys(cfg.layout.tableColumns);
    expect(cols[0]).toBe("campaign");
    expect(cols).toEqual([
      "campaign",
      "investment",
      "results",
      "cost_per_result",
      "ctr",
      "cpm",
      "status",
    ]);
  });

  it("todo item do catálogo aparece na lista (ativo ou não)", () => {
    expect(cfg.layout.cards).toHaveLength(CARD_CATALOG.length);
    expect(cfg.layout.charts).toHaveLength(CHART_CATALOG.length);
    expect(cfg.layout.tableColumns).toHaveLength(TABLE_COLUMN_CATALOG.length);
  });

  it("JSON vazio cai na configuração padrão segura", () => {
    const parsed = parseDashboardConfig(null);
    expect(enabledKeys(parsed.layout.cards)).toEqual(
      enabledKeys(cfg.layout.cards),
    );
    expect(parsed.layout.tableColumns[0].key).toBe(REQUIRED_TABLE_COLUMN);
  });
});

/* ---------- validação das métricas / comportamento ---------- */

describe("métrica principal", () => {
  const base = () => structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;

  it("aceita todos os tipos e comportamentos previstos", () => {
    for (const type of RESULT_METRIC_TYPES) {
      for (const behavior of METRIC_BEHAVIORS) {
        const input = base();
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

  it("rejeita tipo de métrica desconhecido", () => {
    const input = base();
    input.resultMetric = { ...input.resultMetric, type: "sales" as never };
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("rejeita comportamento inválido", () => {
    const input = base();
    input.resultMetric = { ...input.resultMetric, behavior: "always_good" as never };
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("rejeita nome exibido vazio", () => {
    const input = base();
    input.resultMetric = { ...input.resultMetric, resultLabel: "   " };
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });
});

/* ---------- cards / gráficos / colunas permitidos ---------- */

describe("catálogos fechados", () => {
  it("parse descarta chaves de card fora do catálogo", () => {
    const parsed = parseDashboardConfig({
      layout: {
        cards: [
          { key: "investment", enabled: true },
          { key: "hack_card", enabled: true },
        ],
      },
    });
    expect(parsed.layout.cards.some((c) => c.key === "hack_card")).toBe(false);
  });

  it("sanitize rejeita chave de gráfico fora do catálogo", () => {
    const input = structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;
    input.layout.charts.push({ key: "evil_chart", enabled: true });
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("sanitize rejeita coluna fora do catálogo", () => {
    const input = structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;
    input.layout.tableColumns.push({ key: "secret", enabled: true });
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("card que depende da Meta não pode ser ativado", () => {
    const input = structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;
    const roas = input.layout.cards.find((c) => c.key === "roas");
    if (roas) roas.enabled = true;
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });

  it("parse força card requiresMeta como desativado", () => {
    const parsed = parseDashboardConfig({
      layout: { cards: [{ key: "roas", enabled: true }] },
    });
    expect(parsed.layout.cards.find((c) => c.key === "roas")?.enabled).toBe(false);
  });
});

/* ---------- coluna Campanha obrigatória ---------- */

describe("coluna Campanha", () => {
  it("parse sempre coloca Campanha ativa e em primeiro", () => {
    const parsed = parseDashboardConfig({
      layout: {
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

  it("sanitize rejeita payload com Campanha desativada", () => {
    const input = structuredClone(DEFAULT_DASHBOARD_CONFIG) as DashboardConfigValue;
    const campaign = input.layout.tableColumns.find((c) => c.key === "campaign");
    if (campaign) campaign.enabled = false;
    expect(sanitizeDashboardConfigInput(input)).toMatchObject({ ok: false });
  });
});

/* ---------- ordem ---------- */

describe("ordem", () => {
  it("parse preserva a ordem dos itens ativos informada", () => {
    const parsed = parseDashboardConfig({
      layout: {
        cards: [
          { key: "reach", enabled: true },
          { key: "investment", enabled: true },
          { key: "ctr", enabled: true },
        ],
      },
    });
    expect(enabledKeys(parsed.layout.cards)).toEqual([
      "reach",
      "investment",
      "ctr",
    ]);
  });

  it("moveItem troca posições sem sair dos limites", () => {
    const list = [
      { key: "a", enabled: true },
      { key: "b", enabled: true },
      { key: "c", enabled: true },
    ];
    expect(moveItem(list, 0, 1).map((i) => i.key)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 0, -1)).toBe(list); // no-op nos limites
    expect(moveItem(list, 2, 1)).toBe(list);
  });

  it("toggleItem inverte só o item alvo", () => {
    const list = [
      { key: "a", enabled: true },
      { key: "b", enabled: false },
    ];
    const next = toggleItem(list, "b");
    expect(next.find((i) => i.key === "b")?.enabled).toBe(true);
    expect(next.find((i) => i.key === "a")?.enabled).toBe(true);
  });
});

/* ---------- rejeição de valores inválidos ---------- */

describe("rejeição de valores inválidos", () => {
  it("rejeita entradas não-objeto", () => {
    expect(sanitizeDashboardConfigInput(null)).toMatchObject({ ok: false });
    expect(sanitizeDashboardConfigInput("x")).toMatchObject({ ok: false });
    expect(sanitizeDashboardConfigInput(42)).toMatchObject({ ok: false });
  });

  it("rejeita layout com listas ausentes", () => {
    expect(
      sanitizeDashboardConfigInput({
        resultMetric: DEFAULT_DASHBOARD_CONFIG.resultMetric,
        layout: { cards: [], charts: [] },
      }),
    ).toMatchObject({ ok: false });
  });

  it("parse nunca lança, mesmo com lixo", () => {
    expect(() =>
      parseDashboardConfig({
        result_metric: "???" as unknown,
        layout: [1, 2, 3] as unknown,
      }),
    ).not.toThrow();
  });
});
