/**
 * Seleção autoritativa de meta_insights_periodic (lib/meta/periodic-select.ts).
 * Regra compartilhada entre Agency Overview e dashboard individual.
 */
import { describe, expect, it } from "vitest";
import {
  PERIODIC_ATTRIBUTION_PRIORITY,
  selectAuthoritativePeriodicByEntity,
  selectAuthoritativePeriodicRow,
} from "@/lib/meta/periodic-select";

const RANGE = { from: "2026-08-06", to: "2026-09-04" };

const row = (o: Record<string, unknown>) => ({
  entity_id: "act_1",
  date_from: RANGE.from,
  date_to: RANGE.to,
  attribution_window: "unified_attribution",
  spend: 100,
  ...o,
});

describe("selectAuthoritativePeriodicRow", () => {
  it("escolhe a linha do INTERVALO EXATO do range", () => {
    const picked = selectAuthoritativePeriodicRow(
      [row({ spend: 100 })],
      RANGE,
    );
    expect(picked?.spend).toBe(100);
  });

  it("ignora linha do mesmo preset com intervalo ANTIGO (defasado 1 dia)", () => {
    const picked = selectAuthoritativePeriodicRow(
      [
        row({ date_from: "2026-08-05", date_to: "2026-09-03", spend: 999 }), // janela de ontem
        row({ date_from: "2026-08-04", date_to: "2026-09-02", spend: 888 }),
      ],
      RANGE,
    );
    expect(picked).toBeNull(); // nenhuma casa o range exato -> cai no daily
  });

  it("com intervalo exato E antigo juntos, pega SÓ o exato", () => {
    const picked = selectAuthoritativePeriodicRow(
      [
        row({ date_from: "2026-08-05", date_to: "2026-09-03", spend: 999 }),
        row({ spend: 100 }), // exato
      ],
      RANGE,
    );
    expect(picked?.spend).toBe(100);
  });

  it("unified_attribution vence legado no MESMO range (determinístico, não ordem do banco)", () => {
    const legacyFirst = selectAuthoritativePeriodicRow(
      [
        row({ attribution_window: "7d_click_1d_view", spend: 50 }),
        row({ attribution_window: "unified_attribution", spend: 100 }),
      ],
      RANGE,
    );
    const unifiedFirst = selectAuthoritativePeriodicRow(
      [
        row({ attribution_window: "unified_attribution", spend: 100 }),
        row({ attribution_window: "7d_click_1d_view", spend: 50 }),
      ],
      RANGE,
    );
    expect(legacyFirst?.spend).toBe(100);
    expect(unifiedFirst?.spend).toBe(100);
  });

  it("legado só entra se NÃO existir unified para o mesmo range", () => {
    const picked = selectAuthoritativePeriodicRow(
      [row({ attribution_window: "7d_click_1d_view", spend: 50 })],
      RANGE,
    );
    expect(picked?.spend).toBe(50);
  });

  it("nenhuma linha -> null (ausência de periodic)", () => {
    expect(selectAuthoritativePeriodicRow([], RANGE)).toBeNull();
  });

  it("prioridade documentada: unified antes do legado", () => {
    expect(PERIODIC_ATTRIBUTION_PRIORITY[0]).toBe("unified_attribution");
    expect(PERIODIC_ATTRIBUTION_PRIORITY[1]).toBe("7d_click_1d_view");
  });
});

describe("selectAuthoritativePeriodicByEntity", () => {
  it("resolve a linha autoritativa de CADA entity_id independentemente", () => {
    const map = selectAuthoritativePeriodicByEntity(
      [
        row({ entity_id: "act_1", spend: 100 }),
        row({ entity_id: "act_1", date_from: "2026-08-05", date_to: "2026-09-03", spend: 999 }),
        row({ entity_id: "act_2", spend: 200 }),
        row({ entity_id: "act_2", attribution_window: "7d_click_1d_view", spend: 20 }),
      ],
      RANGE,
    );
    expect(map.get("act_1")?.spend).toBe(100);
    expect(map.get("act_2")?.spend).toBe(200); // unified vence legado
  });

  it("conta sem linha do intervalo exato NÃO aparece no mapa (cai no daily fallback)", () => {
    const map = selectAuthoritativePeriodicByEntity(
      [
        row({ entity_id: "act_1", spend: 100 }),
        row({ entity_id: "act_2", date_from: "2026-08-05", date_to: "2026-09-03", spend: 999 }),
      ],
      RANGE,
    );
    expect(map.has("act_1")).toBe(true);
    expect(map.has("act_2")).toBe(false);
  });

  it("entity_id não-string é ignorado", () => {
    const map = selectAuthoritativePeriodicByEntity(
      [row({ entity_id: null, spend: 1 }), row({ entity_id: "act_1", spend: 100 })],
      RANGE,
    );
    expect([...map.keys()]).toEqual(["act_1"]);
  });
});
