import { describe, expect, it } from "vitest";
import {
  attributeAdToCreative,
  type AttributionInput,
} from "@/lib/meta/creative-attribution";

const base: Omit<AttributionInput, "relation"> = {
  period: { start: "2026-08-03", end: "2026-09-01" },
  today: "2026-09-02",
  otherRelations: [],
  adUpdatedDate: null,
};

function reasons(w: ReturnType<typeof attributeAdToCreative>) {
  return new Set(w.excluded.map((e) => e.reason));
}

describe("attributeAdToCreative — janela observacional + boundary days", () => {
  it("relação inexistente => UNATTRIBUTABLE, todos os dias not_observed", () => {
    const w = attributeAdToCreative({ ...base, relation: null });
    expect(w.status).toBe("UNATTRIBUTABLE");
    expect(w.attributableDates).toHaveLength(0);
    expect(reasons(w)).toEqual(new Set(["not_observed"]));
  });

  it("1ª sincronização hoje: janela curta, período de 30d fica NÃO confirmado", () => {
    // first_seen = last_seen = hoje (02/09). Boundary + "hoje" -> nada seguro.
    const w = attributeAdToCreative({
      ...base,
      relation: { firstSeen: "2026-09-02", lastSeen: "2026-09-02" },
    });
    expect(w.status).toBe("UNATTRIBUTABLE");
    expect(w.attributableDates).toHaveLength(0);
    expect(reasons(w)).toContain("pre_first_observation");
  });

  it("first_seen no meio de um dia NÃO torna aquele dia totalmente atribuível", () => {
    // vimos C de 20/08 (1ª obs) a 01/09; hoje 02/09.
    const w = attributeAdToCreative({
      ...base,
      relation: { firstSeen: "2026-08-20", lastSeen: "2026-09-01" },
    });
    // 20/08 é boundary (contém atividade anterior às 17h da 1ª sync) -> excluído
    expect(w.attributableDates).not.toContain("2026-08-20");
    expect(w.attributableDates[0]).toBe("2026-08-21");
    // janela segura termina em 01/09 (last_seen) — não em "hoje"
    expect(w.attributableDates.at(-1)).toBe("2026-09-01");
    expect(w.status).toBe("PARTIALLY_ATTRIBUTABLE");
    expect(reasons(w)).toContain("pre_first_observation");
    expect(reasons(w)).toContain("boundary_observation_day");
  });

  it("período só com o boundary day NÃO vira atribuição completa", () => {
    const w = attributeAdToCreative({
      period: { start: "2026-08-20", end: "2026-08-20" },
      today: "2026-08-25",
      otherRelations: [],
      adUpdatedDate: null,
      relation: { firstSeen: "2026-08-20", lastSeen: "2026-08-24" },
    });
    expect(w.status).toBe("UNATTRIBUTABLE");
    expect(reasons(w)).toEqual(new Set(["boundary_observation_day"]));
  });

  it("hoje nunca é histórico totalmente confirmado só porque houve sync hoje", () => {
    // C observado há muito tempo (01/07) e reobservado hoje.
    const w = attributeAdToCreative({
      period: { start: "2026-08-25", end: "2026-09-02" },
      today: "2026-09-02",
      otherRelations: [],
      adUpdatedDate: null,
      relation: { firstSeen: "2026-07-01", lastSeen: "2026-09-02" },
    });
    // cobre quase tudo, MAS 02/09 (hoje) fica de fora -> parcial, não completa
    expect(w.status).toBe("PARTIALLY_ATTRIBUTABLE");
    expect(w.attributableDates).toContain("2026-09-01");
    expect(w.attributableDates).not.toContain("2026-09-02");
    expect(reasons(w)).toContain("boundary_today");
  });

  it("FULLY quando a janela cerca o período inteiro (nada de hoje, sem edição, 1 relação)", () => {
    const w = attributeAdToCreative({
      period: { start: "2026-08-10", end: "2026-08-20" },
      today: "2026-09-02",
      otherRelations: [],
      adUpdatedDate: "2026-07-01", // edição ANTES da 1ª observação
      relation: { firstSeen: "2026-08-01", lastSeen: "2026-08-25" },
    });
    expect(w.status).toBe("FULLY_ATTRIBUTABLE");
    expect(w.attributableDates).toHaveLength(11);
    expect(w.excluded).toHaveLength(0);
  });

  it("updated_time no meio da janela exclui o boundary day e aperta o início", () => {
    const w = attributeAdToCreative({
      period: { start: "2026-08-10", end: "2026-08-20" },
      today: "2026-09-02",
      otherRelations: [],
      adUpdatedDate: "2026-08-14", // ad editado no dia 14 (dentro da janela)
      relation: { firstSeen: "2026-08-01", lastSeen: "2026-08-25" },
    });
    expect(w.status).toBe("PARTIALLY_ATTRIBUTABLE");
    expect(w.attributableDates).not.toContain("2026-08-14"); // boundary_edit_day
    expect(w.attributableDates[0]).toBe("2026-08-15"); // só a partir do dia seguinte
    expect(reasons(w)).toContain("boundary_edit_day");
    expect(reasons(w)).toContain("edited_within_period");
  });

  it("updated_time DEPOIS da última observação => nada atribuível (não reobservado)", () => {
    const w = attributeAdToCreative({
      period: { start: "2026-08-10", end: "2026-08-31" },
      today: "2026-09-02",
      otherRelations: [],
      adUpdatedDate: "2026-08-28", // editado após last_seen (25/08)
      relation: { firstSeen: "2026-08-01", lastSeen: "2026-08-25" },
    });
    expect(w.status).toBe("UNATTRIBUTABLE");
    expect(w.attributableDates).toHaveLength(0);
    expect(reasons(w)).toContain("edited_within_period");
  });

  it("troca de creative observada => gap excluído, resto parcial", () => {
    // Creative A visto 01–10/08; Creative C (alvo) visto 20–31/08.
    const w = attributeAdToCreative({
      period: { start: "2026-08-01", end: "2026-08-31" },
      today: "2026-09-02",
      otherRelations: [{ firstSeen: "2026-08-01", lastSeen: "2026-08-10" }],
      adUpdatedDate: null,
      relation: { firstSeen: "2026-08-20", lastSeen: "2026-08-31" },
    });
    expect(w.status).toBe("PARTIALLY_ATTRIBUTABLE");
    // dias 11–19/08 = gap de troca; 01–10 pertencem a A
    expect(w.attributableDates).not.toContain("2026-08-15");
    expect(w.attributableDates[0]).toBe("2026-08-21"); // 20 é boundary
    expect(reasons(w)).toContain("creative_swap_gap");
  });

  it("dias excluídos aparecem contabilizados (buckets por motivo)", () => {
    const w = attributeAdToCreative({
      ...base,
      relation: { firstSeen: "2026-08-28", lastSeen: "2026-09-01" },
    });
    const total = w.attributableDates.length + w.excluded.length;
    expect(total).toBe(30); // 03/08–01/09
    expect(w.excluded.filter((e) => e.reason === "pre_first_observation").length).toBe(25);
    expect(w.excluded.filter((e) => e.reason === "boundary_observation_day").length).toBe(1);
  });

  it("first_seen > início do período => nada antes de first_seen é atribuído", () => {
    const w = attributeAdToCreative({
      period: { start: "2026-08-01", end: "2026-08-31" },
      today: "2026-09-02",
      otherRelations: [],
      adUpdatedDate: null,
      relation: { firstSeen: "2026-08-25", lastSeen: "2026-08-31" },
    });
    for (const d of w.attributableDates) expect(d >= "2026-08-26").toBe(true);
    expect(w.status).toBe("PARTIALLY_ATTRIBUTABLE");
  });
});
