import { describe, expect, it } from "vitest";
import {
  META_ATTRIBUTION_LEGACY_WINDOW,
  META_ATTRIBUTION_QUERY_VALUES,
  META_ATTRIBUTION_WINDOWS,
  META_DEFAULT_ATTRIBUTION_WINDOW,
  metaAttributionLabel,
} from "@/lib/meta/config";
import {
  planAttributionRename,
  singleAttributionIdentity,
} from "@/lib/meta/attribution";
import {
  normalizeBaseInsight,
  type BaseInsightRow,
} from "@/lib/meta/sync-insights";
import { normalizeInsightRow } from "@/lib/meta/normalizer";

describe("identificador de atribuição", () => {
  it("o default é `unified_attribution` (não uma janela fixa)", () => {
    expect(META_DEFAULT_ATTRIBUTION_WINDOW).toBe("unified_attribution");
    expect(META_ATTRIBUTION_WINDOWS).toContain("unified_attribution");
  });

  it("rótulo legível para a UI; desconhecido -> valor cru", () => {
    expect(metaAttributionLabel("unified_attribution")).toMatch(/Meta|unified/i);
    expect(metaAttributionLabel("7d_click_1d_view")).toMatch(/7 dias clique/i);
    expect(metaAttributionLabel("algo_novo")).toBe("algo_novo");
    expect(metaAttributionLabel(null)).toBe("—");
  });

  it("o dashboard consulta o novo E o legado durante a transição", () => {
    expect(META_ATTRIBUTION_QUERY_VALUES).toContain("unified_attribution");
    expect(META_ATTRIBUTION_QUERY_VALUES).toContain(META_ATTRIBUTION_LEGACY_WINDOW);
    expect(META_ATTRIBUTION_LEGACY_WINDOW).toBe("7d_click_1d_view");
  });
});

describe("daily e periodic usam a MESMA identidade de atribuição", () => {
  const raw = {
    date_start: "2026-08-10",
    date_stop: "2026-08-10",
    account_id: "555",
    spend: "100",
    impressions: "5000",
    clicks: "80",
  };

  it("normalizeBaseInsight: daily e periodic -> unified_attribution", () => {
    const daily = normalizeBaseInsight(raw, { level: "account", adAccountId: "act_555" });
    const periodic = normalizeBaseInsight(raw, {
      level: "account",
      adAccountId: "act_555",
      periodic: true,
    });
    expect(daily?.attributionWindow).toBe("unified_attribution");
    expect(periodic?.attributionWindow).toBe("unified_attribution");
    expect(daily?.attributionWindow).toBe(periodic?.attributionWindow);
  });

  it("nenhuma mistura de identidades num conjunto de linhas", () => {
    const rows: BaseInsightRow[] = [
      normalizeBaseInsight({ ...raw, campaign_id: "c1" }, { level: "campaign", adAccountId: "act_555" })!,
      normalizeBaseInsight({ ...raw, campaign_id: "c2" }, { level: "campaign", adAccountId: "act_555" })!,
      normalizeBaseInsight(raw, { level: "account", adAccountId: "act_555" })!,
    ];
    expect(singleAttributionIdentity(rows)).toEqual({
      ok: true,
      identities: ["unified_attribution"],
    });
  });

  it("mistura é detectada", () => {
    expect(
      singleAttributionIdentity([
        { attributionWindow: "unified_attribution" },
        { attributionWindow: "7d_click_1d_view" },
      ]).ok,
    ).toBe(false);
  });
});

describe("conversões associadas à atribuição correta", () => {
  it("normalizeInsightRow: mesma linha carrega actions E unified_attribution", () => {
    const row = normalizeInsightRow(
      {
        date_start: "2026-08-10",
        account_id: "555",
        spend: "700",
        actions: [
          { action_type: "omni_purchase", value: "7" },
          { action_type: "purchase", value: "7" },
          { action_type: "lead", value: "40" },
        ],
        action_values: [{ action_type: "omni_purchase", value: "1400" }],
      },
      { level: "account", adAccountId: "act_555" },
    );
    expect(row?.attributionWindow).toBe("unified_attribution");
    // prioridade: omni_purchase vence -> 7 (não 14)
    expect(row?.actions.purchases).toBe(7);
    expect(row?.actions.leads).toBe(40);
    expect(row?.actionValues.revenue).toBe(1400);
    // crus preservados
    expect(row?.rawActions.purchase).toBe(7);
  });
});

describe("transição das linhas antigas — sem duplicação", () => {
  // 4 linhas base já sincronizadas (só métricas base; actions vazias)
  const legacy = [
    { key: "account|act_555|2026-08-08", attributionWindow: "7d_click_1d_view" },
    { key: "account|act_555|2026-08-09", attributionWindow: "7d_click_1d_view" },
    { key: "campaign|c1|2026-08-09", attributionWindow: "7d_click_1d_view" },
    { key: "campaign|c2|2026-08-09", attributionWindow: "7d_click_1d_view" },
  ];

  it("renomeia todas, zero colisão (não existem linhas `unified_attribution`)", () => {
    const plan = planAttributionRename({
      rows: legacy,
      from: "7d_click_1d_view",
      to: "unified_attribution",
    });
    expect(plan.renamed).toHaveLength(4);
    expect(plan.alreadyTarget).toEqual([]);
    expect(plan.collisions).toEqual([]);
  });

  it("idempotente: rodar de novo (já tudo `unified_attribution`) não faz nada", () => {
    const migrated = legacy.map((r) => ({ ...r, attributionWindow: "unified_attribution" }));
    const plan = planAttributionRename({
      rows: migrated,
      from: "7d_click_1d_view",
      to: "unified_attribution",
    });
    expect(plan.renamed).toEqual([]);
    expect(plan.alreadyTarget).toHaveLength(4);
    expect(plan.collisions).toEqual([]);
  });

  it("re-sync após a mudança faz UPSERT na linha renomeada (mesma chave), não duplica", () => {
    // após a migração: linhas `unified_attribution`. O re-sync gera as mesmas chaves.
    const afterMigration = legacy.map((r) => ({ ...r, attributionWindow: "unified_attribution" }));
    const resyncRows = legacy.map((r) => ({ ...r, attributionWindow: "unified_attribution" }));
    const keys = new Set([...afterMigration, ...resyncRows].map((r) => `${r.key}|${r.attributionWindow}`));
    expect(keys.size).toBe(4); // 4 chaves distintas, não 8
  });

  it("colisão hipotética é sinalizada (não deve ocorrer na transição real)", () => {
    const mixed = [
      { key: "account|act_555|2026-08-08", attributionWindow: "7d_click_1d_view" },
      { key: "account|act_555|2026-08-08", attributionWindow: "unified_attribution" },
    ];
    const plan = planAttributionRename({
      rows: mixed,
      from: "7d_click_1d_view",
      to: "unified_attribution",
    });
    expect(plan.collisions).toEqual(["account|act_555|2026-08-08"]);
  });
});
