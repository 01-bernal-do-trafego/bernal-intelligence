import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_DISCOVERY_PROBES,
  discoverEarliestDate,
  type ProbeFn,
  type ProbeRange,
} from "@/lib/backfill/earliest-date-discovery";

/** simula a Meta: existe dado num range sse alguma data marcada estiver em [since, until]. */
function fakeProbe(datesWithData: readonly string[]): { probe: ProbeFn; calls: ProbeRange[] } {
  const set = new Set(datesWithData);
  const calls: ProbeRange[] = [];
  const probe: ProbeFn = async (range) => {
    calls.push(range);
    for (const d of set) {
      if (d >= range.since && d <= range.until) return { hasData: true };
    }
    return { hasData: false };
  };
  return { probe, calls };
}

describe("A) conta criada e começou a anunciar no mesmo dia", () => {
  it("earliestDate === accountCreatedDate", async () => {
    const { probe } = fakeProbe(["2024-01-10"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-10", latestClosedDate: "2024-06-01", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2024-01-10", strategy: "full_range" });
  });
});

describe("B) conta criada meses antes da primeira campanha", () => {
  it("earliestDate é a data real da 1ª campanha, não a criação da conta", async () => {
    const { probe } = fakeProbe(["2024-05-15"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-12-31", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2024-05-15" });
  });
});

describe("C) long history (vários anos)", () => {
  it("encontra a data correta em um range de ~5 anos, com poucos probes (não escaneia dia a dia)", async () => {
    const { probe, calls } = fakeProbe(["2020-03-17"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2025-09-01", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2020-03-17" });
    const totalDays = 2070; // ~5.6 anos
    expect(calls.length).toBeLessThan(20); // muito menor que totalDays
    expect(calls.length).toBeLessThan(Math.log2(totalDays) + 5);
  });
});

describe("D) somente atividade recente", () => {
  it("earliestDate é a data recente, mesmo com um range antigo enorme", async () => {
    const { probe } = fakeProbe(["2026-08-20"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2015-01-01", latestClosedDate: "2026-09-10", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2026-08-20" });
  });
});

describe("E) sem atividade nenhuma -> no_history (nunca inventa data)", () => {
  it("range inteiro sem dado -> no_history, sem tentar binary search", async () => {
    const { probe, calls } = fakeProbe([]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-12-31", probe });
    expect(out).toMatchObject({ status: "no_history", strategy: "full_range" });
    expect(calls).toHaveLength(1); // só o probe do range inteiro — não faz mais nada.
  });
});

describe("F) leap year — 29 de fevereiro tratado corretamente", () => {
  it("data exata em 2024-02-29 (ano bissexto) é encontrada", async () => {
    const { probe } = fakeProbe(["2024-02-29"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-06-01", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2024-02-29" });
  });
});

describe("G) month boundaries — dado exatamente no primeiro dia de um mês", () => {
  it("encontra 2024-03-01 corretamente (fronteira fev->mar)", async () => {
    const { probe } = fakeProbe(["2024-03-01"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-06-01", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2024-03-01" });
  });
  it("encontra 2024-12-31 (fronteira dez->jan do ano seguinte, dentro do range)", async () => {
    const { probe } = fakeProbe(["2024-12-31"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2025-01-31", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2024-12-31" });
  });
});

describe("candidate lower === upper (range de 1 dia só)", () => {
  it("com dado -> found na própria data; sem dado -> no_history", async () => {
    const withData = fakeProbe(["2026-01-01"]);
    const out1 = await discoverEarliestDate({ accountCreatedDate: "2026-01-01", latestClosedDate: "2026-01-01", probe: withData.probe });
    expect(out1).toMatchObject({ status: "found", earliestDate: "2026-01-01" });

    const withoutData = fakeProbe([]);
    const out2 = await discoverEarliestDate({ accountCreatedDate: "2026-01-01", latestClosedDate: "2026-01-01", probe: withoutData.probe });
    expect(out2).toMatchObject({ status: "no_history" });
  });
  it("accountCreatedDate > latestClosedDate (conta criada hoje, sem dia fechado ainda) -> no_history, ZERO probes", async () => {
    const { probe, calls } = fakeProbe([]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2026-09-11", latestClosedDate: "2026-09-10", probe });
    expect(out).toEqual({ status: "no_history", probesPerformed: 0, strategy: "full_range" });
    expect(calls).toHaveLength(0);
  });
});

describe("binary search encontra a primeira data em várias posições", () => {
  for (const pos of ["2023-01-01", "2023-06-15", "2023-12-31"]) {
    it(`data em ${pos} dentro de um range de 1 ano`, async () => {
      const { probe } = fakeProbe([pos]);
      const out = await discoverEarliestDate({ accountCreatedDate: "2023-01-01", latestClosedDate: "2023-12-31", probe });
      expect(out).toMatchObject({ status: "found", earliestDate: pos });
    });
  }
});

describe("não faz scan diário — probe count é bounded/logarítmico", () => {
  it("para qualquer posição num range de 1000 dias, nunca mais que ~15 probes", async () => {
    const { probe, calls } = fakeProbe(["2023-11-20"]);
    await discoverEarliestDate({ accountCreatedDate: "2022-01-01", latestClosedDate: "2024-09-27", probe }); // ~1000 dias
    expect(calls.length).toBeLessThan(15);
  });
});

describe("range_rejected (e SÓ range_rejected) NÃO vira no_history — fallback chunked", () => {
  it("1º probe (range inteiro) falha com range_rejected -> cai para blocos; acha o bloco certo e refina dentro dele", async () => {
    const set = new Set(["2021-08-10"]);
    const calls: ProbeRange[] = [];
    let call = 0;
    const probe: ProbeFn = async (range) => {
      call += 1;
      calls.push(range);
      if (call === 1) return { hasData: false, errorKind: "range_rejected" }; // range inteiro rejeitado
      for (const d of set) if (d >= range.since && d <= range.until) return { hasData: true };
      return { hasData: false };
    };
    const out = await discoverEarliestDate({
      accountCreatedDate: "2020-01-01",
      latestClosedDate: "2022-12-31",
      probe,
      chunkDays: 180,
    });
    expect(out).toMatchObject({ status: "found", earliestDate: "2021-08-10", strategy: "chunked" });
  });

  it("fallback chunked sem NENHUM bloco com dado -> no_history (nunca finge que achou)", async () => {
    let call = 0;
    const probe: ProbeFn = async () => {
      call += 1;
      if (call === 1) return { hasData: false, errorKind: "range_rejected" };
      return { hasData: false };
    };
    const out = await discoverEarliestDate({
      accountCreatedDate: "2020-01-01",
      latestClosedDate: "2020-12-31",
      probe,
      chunkDays: 90,
    });
    expect(out).toMatchObject({ status: "no_history", strategy: "chunked" });
  });

  it("erro DENTRO do fallback chunked (não só no probe inicial) -> probe_error, nunca no_history/found forjado", async () => {
    let call = 0;
    const probe: ProbeFn = async () => {
      call += 1;
      return { hasData: false, errorKind: call === 1 ? "range_rejected" : "rate_limited" };
    };
    const out = await discoverEarliestDate({
      accountCreatedDate: "2020-01-01",
      latestClosedDate: "2020-12-31",
      probe,
      chunkDays: 90,
    });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "rate_limited" });
  });
});

describe("SOMENTE range_rejected aciona o fallback — qualquer outro erro no probe inicial falha explicitamente, SEM fallback", () => {
  const nonRangeErrorKinds = ["token_revoked", "insufficient_permission", "rate_limited", "transient", "unknown"] as const;

  for (const errorKind of nonRangeErrorKinds) {
    it(`errorKind="${errorKind}" no probe do range inteiro -> probe_error IMEDIATO, NUNCA fallback chunked`, async () => {
      const calls: ProbeRange[] = [];
      const probe: ProbeFn = async (range) => {
        calls.push(range);
        return { hasData: false, errorKind };
      };
      const out = await discoverEarliestDate({
        accountCreatedDate: "2020-01-01",
        latestClosedDate: "2022-12-31",
        probe,
        chunkDays: 180,
      });
      expect(out).toEqual({ status: "probe_error", errorKind, probesPerformed: 1 });
      // 1 único probe — nunca tenta um 2º bloco/chunk.
      expect(calls).toHaveLength(1);
    });
  }

  it("auth error (token_revoked) nunca mascarado como no_history/found", async () => {
    const probe: ProbeFn = async () => ({ hasData: false, errorKind: "token_revoked" });
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2020-12-31", probe });
    expect(out.status).toBe("probe_error");
    expect(out.status).not.toBe("no_history");
    expect(out.status).not.toBe("found");
  });

  it("permission error (insufficient_permission) nunca mascarado como no_history/found", async () => {
    const probe: ProbeFn = async () => ({ hasData: false, errorKind: "insufficient_permission" });
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2020-12-31", probe });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "insufficient_permission" });
  });

  it("rate-limit nunca mascarado como no_history/found, e NUNCA gera fallback (nenhuma chamada extra)", async () => {
    const calls: ProbeRange[] = [];
    const probe: ProbeFn = async (range) => {
      calls.push(range);
      return { hasData: false, errorKind: "rate_limited" };
    };
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2020-12-31", probe });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "rate_limited" });
    expect(calls).toHaveLength(1);
  });

  it("erro de rede/5xx genérico (transient) nunca mascarado como no_history/found", async () => {
    const probe: ProbeFn = async () => ({ hasData: false, errorKind: "transient" });
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2020-12-31", probe });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "transient" });
  });

  it("resposta malformada/não classificada (unknown) também NÃO aciona fallback", async () => {
    const probe: ProbeFn = async () => ({ hasData: false, errorKind: "unknown" });
    const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2020-12-31", probe });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "unknown" });
  });
});

describe("caso feliz (binary search) continua correto depois do hardening", () => {
  it("sem erro nenhum, encontra a data certa via full_range (não passa pelo fallback)", async () => {
    const { probe } = fakeProbe(["2023-06-15"]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2023-01-01", latestClosedDate: "2023-12-31", probe });
    expect(out).toMatchObject({ status: "found", earliestDate: "2023-06-15", strategy: "full_range" });
  });
});

describe("no_history continua correto depois do hardening", () => {
  it("range inteiro sem erro e sem dado -> no_history, 1 único probe", async () => {
    const { probe, calls } = fakeProbe([]);
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-12-31", probe });
    expect(out).toMatchObject({ status: "no_history", strategy: "full_range" });
    expect(calls).toHaveLength(1);
  });
});

describe("MAX_DISCOVERY_PROBES nunca é excedido", () => {
  it("fallback chunked (range_rejected) + range gigante sem dado -> esgota o limite -> probe_limit_exceeded, nunca loop infinito", async () => {
    let call = 0;
    const probe: ProbeFn = async () => {
      call += 1;
      return call === 1 ? { hasData: false, errorKind: "range_rejected" } : { hasData: false };
    };
    const out = await discoverEarliestDate({
      accountCreatedDate: "1990-01-01", // range gigante -> muitos blocos no fallback
      latestClosedDate: "2026-09-10",
      probe,
      maxProbes: 5,
      chunkDays: 30,
    });
    expect(out).toEqual({ status: "probe_limit_exceeded", probesPerformed: 5 });
    expect(call).toBe(5); // nunca chama além do limite
  });

  it("default de DEFAULT_MAX_DISCOVERY_PROBES é 60 (documentado, não arbitrário)", () => {
    expect(DEFAULT_MAX_DISCOVERY_PROBES).toBe(60);
  });
});

describe("confirmação do dia exato — defesa contra falso positivo do binary search", () => {
  it("se o probe do dia exato (candidato) devolver hasData=false -> confirmation_failed, NUNCA 'found' forçado", async () => {
    // fabrica uma inconsistência deliberada: o range largo diz que há dado,
    // mas o probe do dia exato do candidato encontrado nunca confirma.
    const probe: ProbeFn = async (range) => {
      if (range.since === range.until) return { hasData: false }; // toda confirmação de dia único falha
      return { hasData: true }; // qualquer range >1 dia "tem dado"
    };
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-01-10", probe });
    expect(out.status).toBe("confirmation_failed");
  });
});

describe("erro de probe fora do fallback (na confirmação ou binary search) nunca vira no_history/found", () => {
  it("erro durante a confirmação -> probe_error", async () => {
    const probe: ProbeFn = async (range) => {
      if (range.since === range.until) return { hasData: false, errorKind: "transient" };
      return { hasData: true };
    };
    const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-01-10", probe });
    expect(out).toMatchObject({ status: "probe_error", errorKind: "transient" });
  });
});
