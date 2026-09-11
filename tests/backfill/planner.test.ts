import { describe, expect, it } from "vitest";
import { planBackfillSegments } from "@/lib/backfill/planner";
import { resolveBlockSizeDays, BLOCK_SIZE_DAYS } from "@/lib/backfill/block-size";

describe("9. targetStartDate null NÃO inventa histórico", () => {
  it("sem targetStartDate e sem resolvedEarliestDate -> requiresDiscovery, zero segmentos", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account"],
      targetStartDate: null,
      targetEndDate: "2026-09-01",
      resolvedEarliestDate: null,
    });
    expect(out.requiresDiscovery).toBe(true);
    expect(out.segments).toEqual([]);
  });

  it("sem targetStartDate MAS com resolvedEarliestDate (já descoberto) -> planeja normalmente", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account"],
      targetStartDate: null,
      targetEndDate: "2026-09-01",
      resolvedEarliestDate: "2026-08-01",
    });
    expect(out.requiresDiscovery).toBe(false);
    expect(out.segments.length).toBeGreaterThan(0);
  });

  it("targetStartDate explícito tem prioridade sobre resolvedEarliestDate", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account"],
      targetStartDate: "2026-08-15",
      targetEndDate: "2026-09-01",
      resolvedEarliestDate: "2026-01-01", // seria ignorado
    });
    const last = out.segments[out.segments.length - 1];
    expect(last.dateFrom).toBe("2026-08-15");
  });
});

describe("7. date_from <= date_to em todo segmento", () => {
  it("nunca gera um segmento invertido", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account", "campaign", "adset", "ad"],
      targetStartDate: "2026-06-01",
      targetEndDate: "2026-09-10",
      resolvedEarliestDate: null,
    });
    for (const seg of out.segments) {
      expect(seg.dateFrom <= seg.dateTo, `${seg.level} ${seg.dateFrom}..${seg.dateTo}`).toBe(true);
    }
  });

  it("lança se earliest > targetEndDate (bug de quem chama)", () => {
    expect(() =>
      planBackfillSegments({
        jobId: "job-1",
        requestedLevels: ["account"],
        targetStartDate: "2026-09-10",
        targetEndDate: "2026-09-01",
        resolvedEarliestDate: null,
      }),
    ).toThrow(/earliest/);
  });
});

describe("6. planner trabalha newest -> oldest dentro de cada nível", () => {
  it("primeiro segmento de cada nível termina em targetEndDate; datas decrescem", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account"],
      targetStartDate: "2026-01-01",
      targetEndDate: "2026-09-10",
      resolvedEarliestDate: null,
    });
    expect(out.segments[0].dateTo).toBe("2026-09-10");
    for (let i = 1; i < out.segments.length; i++) {
      expect(out.segments[i].dateTo < out.segments[i - 1].dateTo).toBe(true);
    }
  });
});

describe("5. planner cria intervalos SEM overlap e SEM gap", () => {
  it("o próximo segmento começa exatamente 1 dia antes do início do anterior", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["campaign"], // bloco de 30d — força múltiplos segmentos
      targetStartDate: "2026-01-01",
      targetEndDate: "2026-09-10",
      resolvedEarliestDate: null,
    });
    expect(out.segments.length).toBeGreaterThan(1);
    for (let i = 1; i < out.segments.length; i++) {
      const prevStart = out.segments[i - 1].dateFrom;
      const curEnd = out.segments[i].dateTo;
      const expectedCurEnd = addDaysISO(prevStart, -1);
      expect(curEnd, `segmento ${i}`).toBe(expectedCurEnd);
    }
  });

  it("o primeiro segmento de cada nível termina em targetEndDate; o último começa em earliest", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["campaign"],
      targetStartDate: "2026-01-01",
      targetEndDate: "2026-09-10",
      resolvedEarliestDate: null,
    });
    expect(out.segments[0].dateTo).toBe("2026-09-10");
    expect(out.segments[out.segments.length - 1].dateFrom).toBe("2026-01-01");
  });
});

describe("8. levels corretos — só os solicitados, na ordem canônica", () => {
  it("ordem sempre account -> campaign -> adset -> ad, mesmo se pedido fora de ordem", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["ad", "account"], // fora de ordem de propósito
      targetStartDate: "2026-09-01",
      targetEndDate: "2026-09-05",
      resolvedEarliestDate: null,
    });
    const levelsInOrder = [...new Set(out.segments.map((s) => s.level))];
    expect(levelsInOrder).toEqual(["account", "ad"]);
  });

  it("nível não solicitado nunca aparece", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account"],
      targetStartDate: "2026-09-01",
      targetEndDate: "2026-09-05",
      resolvedEarliestDate: null,
    });
    expect(out.segments.every((s) => s.level === "account")).toBe(true);
  });

  it("order cresce monotonicamente (0, 1, 2, ...) sem repetir", () => {
    const out = planBackfillSegments({
      jobId: "job-1",
      requestedLevels: ["account", "campaign"],
      targetStartDate: "2026-06-01",
      targetEndDate: "2026-09-10",
      resolvedEarliestDate: null,
    });
    const orders = out.segments.map((s) => s.order);
    expect(orders).toEqual(orders.slice().sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe("estratégia de blocos — configurável, não hardcoded como universal", () => {
  it("conta grande (>50 entidades) usa o bloco MÍNIMO da faixa", () => {
    expect(resolveBlockSizeDays("ad", { ads: 95 })).toBe(BLOCK_SIZE_DAYS.ad.min);
  });
  it("conta pequena (<=50 entidades) usa o bloco MÁXIMO da faixa", () => {
    expect(resolveBlockSizeDays("ad", { ads: 9 })).toBe(BLOCK_SIZE_DAYS.ad.max);
  });
  it("sem hint -> usa o default da faixa", () => {
    expect(resolveBlockSizeDays("campaign")).toBe(BLOCK_SIZE_DAYS.campaign.default);
  });
  it("nível account nunca usa heurística de tamanho (sempre default)", () => {
    expect(resolveBlockSizeDays("account", { ads: 999999 })).toBe(BLOCK_SIZE_DAYS.account.default);
  });
  it("config pode ser sobrescrita (não é verdade universal fixa no código)", () => {
    const custom = { ...BLOCK_SIZE_DAYS, ad: { min: 1, max: 2, default: 2 } };
    expect(resolveBlockSizeDays("ad", undefined, custom)).toBe(2);
  });

  it("Atacado do Chinelo (95 ads) é tratado como teste de carga — bloco mínimo em ad", () => {
    expect(resolveBlockSizeDays("ad", { ads: 95 })).toBe(7);
  });
  it("Oversized Store (9 ads) fica bem abaixo do limiar — bloco máximo em ad", () => {
    expect(resolveBlockSizeDays("ad", { ads: 9 })).toBe(14);
  });
});

function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
