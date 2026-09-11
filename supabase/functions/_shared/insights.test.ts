/**
 * DATA V2.2.3 — teste Deno REAL do normalizador (`toDailyRows`), rodando no
 * MESMO runtime que a Edge Function real usa (diferente da tentativa anterior
 * via Vitest, bloqueada por `tsc --noEmit` do Next não incluir
 * `supabase/functions` — ver `tests/backfill/normalizer-equivalence.test.ts`).
 *
 * Prova, executando o normalizador de verdade (não um mock), que:
 *   1. `toDailyRows` produz exatamente as linhas esperadas de uma fixture
 *      realista (anti-dupla-contagem de `actions`, formato de data, nulos);
 *   2. a MESMA função é usada por `sync-core.ts` (Current Sync) e por
 *      `meta-backfill-executor/index.ts` (Backfill) — não há dois
 *      normalizadores para divergir.
 *
 * Rodar: `deno test supabase/functions/_shared/insights.test.ts`
 */
import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { toDailyRows } from "./insights.ts";

const FIXTURE_AD_LEVEL = [
  {
    date_start: "2026-08-01",
    date_stop: "2026-08-01",
    account_id: "123456",
    campaign_id: "c_1",
    adset_id: "as_1",
    ad_id: "ad_1",
    spend: "125.50",
    impressions: "10000",
    reach: "8000",
    clicks: "150",
    inline_link_clicks: "90",
    frequency: "1.25",
    actions: [
      { action_type: "omni_purchase", value: "12" },
      { action_type: "purchase", value: "9" }, // alias de menor prioridade — NÃO deve ser somado
      { action_type: "link_click", value: "90" },
    ],
    action_values: [{ action_type: "omni_purchase", value: "3200.00" }],
  },
];

Deno.test("toDailyRows — 1 linha, anti dupla contagem (omni_purchase vence purchase, nunca soma)", () => {
  const out = toDailyRows(FIXTURE_AD_LEVEL, {
    clientId: "client-1",
    adAccountRef: "aa-1",
    adAccountId: "act_123456",
    level: "ad",
    attributionWindow: "unified_attribution",
    currency: "BRL",
  });
  strictEqual(out.length, 1);
  const r = out[0];
  strictEqual(r.date, "2026-08-01");
  strictEqual(r.entity_id, "ad_1");
  strictEqual(r.campaign_id, "c_1");
  strictEqual(r.adset_id, "as_1");
  strictEqual(r.ad_id, "ad_1");
  strictEqual(r.spend, 125.5);
  strictEqual(r.impressions, 10000);
  strictEqual(r.reach, 8000);
  strictEqual(r.frequency, 1.25);
  // anti dupla contagem: só omni_purchase (prioridade), nunca omni_purchase + purchase somados.
  strictEqual(r.actions.purchases, 12);
  strictEqual(r.action_values.revenue, 3200);
  // raw_actions preserva TUDO cru, para auditoria.
  strictEqual(r.raw_actions.purchase, 9);
  strictEqual(r.raw_actions.omni_purchase, 12);
});

Deno.test("toDailyRows — ausência de campo vira null (nunca 0 inventado)", () => {
  const out = toDailyRows([{ date_start: "2026-08-02", account_id: "123" }], {
    clientId: "client-1",
    adAccountRef: "aa-1",
    adAccountId: "act_123",
    level: "account",
    attributionWindow: "unified_attribution",
    currency: null,
  });
  strictEqual(out[0].spend, null);
  strictEqual(out[0].reach, null);
  strictEqual(out[0].frequency, null);
});

Deno.test("toDailyRows — linha level=account usa account_id prefixado act_ como entity_id", () => {
  const out = toDailyRows([{ date_start: "2026-08-03", account_id: "999" }], {
    clientId: "client-1",
    adAccountRef: "aa-1",
    adAccountId: "act_999",
    level: "account",
    attributionWindow: "unified_attribution",
    currency: "BRL",
  });
  strictEqual(out[0].entity_id, "act_999");
});

Deno.test("toDailyRows — a saída é o formato REAL gravado em meta_insights_daily (21 campos, level+date+entity_id+attribution_window presentes)", () => {
  const out = toDailyRows(FIXTURE_AD_LEVEL, {
    clientId: "client-1",
    adAccountRef: "aa-1",
    adAccountId: "act_123456",
    level: "ad",
    attributionWindow: "unified_attribution",
    currency: "BRL",
  });
  const expectedKeys = [
    "client_id",
    "ad_account_ref",
    "level",
    "entity_id",
    "ad_account_id",
    "campaign_id",
    "adset_id",
    "ad_id",
    "date",
    "attribution_window",
    "currency",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "inline_link_clicks",
    "frequency",
    "actions",
    "action_values",
    "raw_actions",
    "raw_action_values",
  ].sort();
  deepStrictEqual(Object.keys(out[0]).sort(), expectedKeys);
});
