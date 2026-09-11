import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_PAGES,
  executeBackfillSegment,
  type BackfillExecutorDeps,
  type BackfillSegmentTask,
  type FetchPageResult,
} from "@/lib/backfill/executor";
import type { BackfillInsightRow } from "@/lib/backfill/insight-row";
import type { BackfillLevel } from "@/lib/backfill/types";

function row(entityId: string, date: string, spend: number): BackfillInsightRow {
  return {
    client_id: "client-1",
    ad_account_ref: "aa-1",
    level: "ad",
    entity_id: entityId,
    ad_account_id: "act_123",
    campaign_id: "c1",
    adset_id: "as1",
    ad_id: entityId,
    date,
    attribution_window: "unified_attribution",
    currency: "BRL",
    spend,
    impressions: 100,
    reach: 80,
    clicks: 5,
    inline_link_clicks: 3,
    frequency: 1.25,
    actions: {},
    action_values: {},
    raw_actions: {},
    raw_action_values: {},
  };
}

function task(overrides: Partial<BackfillSegmentTask> = {}): BackfillSegmentTask {
  return {
    id: "seg-1",
    jobId: "job-1",
    clientId: "client-1",
    adAccountRef: "aa-1",
    adAccountId: "act_123",
    level: "ad",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-07",
    leaseToken: "token-current",
    ...overrides,
  };
}

function baseDeps(overrides: Partial<BackfillExecutorDeps> = {}): BackfillExecutorDeps {
  return {
    isAccountLinked: vi.fn().mockResolvedValue(true),
    canRunBackfill: vi.fn().mockResolvedValue(true),
    heartbeat: vi.fn().mockResolvedValue(true),
    fetchPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null } satisfies FetchPageResult),
    upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 0 }),
    completeSegment: vi.fn().mockResolvedValue(true),
    failSegment: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("conta unlinked não executa", () => {
  it("recusa antes de checar rate budget, heartbeat ou buscar dados", async () => {
    const deps = baseDeps({ isAccountLinked: vi.fn().mockResolvedValue(false) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "not_linked", pagesFetched: 0, rowsWritten: 0 });
    expect(deps.canRunBackfill).not.toHaveBeenCalled();
    expect(deps.heartbeat).not.toHaveBeenCalled();
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });
});

describe("rate limit — recusa antes de heartbeat/fetch", () => {
  it("canRunBackfill=false -> refused rate_limited, sem heartbeat/fetch", async () => {
    const deps = baseDeps({ canRunBackfill: vi.fn().mockResolvedValue(false) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "rate_limited", pagesFetched: 0, rowsWritten: 0 });
    expect(deps.heartbeat).not.toHaveBeenCalled();
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });
});

describe("1 página, sucesso", () => {
  it("completa com done, rowsWritten/pagesFetched corretos", async () => {
    const rows = [row("ad_1", "2026-08-01", 10)];
    const deps = baseDeps({
      fetchPage: vi.fn().mockResolvedValue({ rows, nextCursor: null }),
      upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }),
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "completed", rowsWritten: 1, pagesFetched: 1 });
    expect(deps.upsertRows).toHaveBeenCalledWith(rows);
    expect(deps.completeSegment).toHaveBeenCalledWith({
      segmentId: "seg-1",
      leaseToken: "token-current",
      rowsWritten: 1,
      pagesFetched: 1,
      outcome: "done",
    });
  });
});

describe("múltiplas páginas (3), sucesso", () => {
  it("acumula rowsWritten/pagesFetched pelas 3 páginas, sem duplicar linhas entre páginas", async () => {
    const p1 = [row("ad_1", "2026-08-01", 10)];
    const p2 = [row("ad_2", "2026-08-02", 20)];
    const p3 = [row("ad_3", "2026-08-03", 30)];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: p1, nextCursor: "c1" })
      .mockResolvedValueOnce({ rows: p2, nextCursor: "c2" })
      .mockResolvedValueOnce({ rows: p3, nextCursor: null });
    const upsertRows = vi
      .fn()
      .mockResolvedValueOnce({ rowsWritten: 1 })
      .mockResolvedValueOnce({ rowsWritten: 1 })
      .mockResolvedValueOnce({ rowsWritten: 1 });
    const deps = baseDeps({ fetchPage, upsertRows });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "completed", rowsWritten: 3, pagesFetched: 3 });
    expect(upsertRows).toHaveBeenNthCalledWith(1, p1);
    expect(upsertRows).toHaveBeenNthCalledWith(2, p2);
    expect(upsertRows).toHaveBeenNthCalledWith(3, p3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: null }));
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "c1" }));
    expect(fetchPage).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: "c2" }));
  });
});

describe("zero data -> skipped_no_data", () => {
  it("página única vazia, sem próxima página -> skipped_no_data, rowsWritten=0, pagesFetched=1", async () => {
    const deps = baseDeps({ fetchPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "skipped_no_data", pagesFetched: 1 });
    expect(deps.upsertRows).not.toHaveBeenCalled();
    expect(deps.completeSegment).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped_no_data", rowsWritten: 0, pagesFetched: 1 }),
    );
  });
});

describe("upsert idempotente — rodar o mesmo segmento 2x não duplica", () => {
  it("estado final (mapa por natural key) é o mesmo depois de 2 execuções", async () => {
    // fake upsert simula o UPSERT real: mesma natural key sobrescreve, nunca duplica.
    const db = new Map<string, BackfillInsightRow>();
    const upsertRows = vi.fn(async (rows: readonly BackfillInsightRow[]) => {
      for (const r of rows) db.set(`${r.level}|${r.entity_id}|${r.date}|${r.attribution_window}`, r);
      return { rowsWritten: rows.length };
    });
    const rows = [row("ad_1", "2026-08-01", 10), row("ad_2", "2026-08-01", 20)];
    const deps = baseDeps({
      fetchPage: vi.fn().mockResolvedValue({ rows, nextCursor: null }),
      upsertRows,
    });

    const first = await executeBackfillSegment(task(), deps);
    expect(first.kind).toBe("completed");
    expect(db.size).toBe(2);

    const second = await executeBackfillSegment(task(), deps);
    expect(second.kind).toBe("completed");
    expect(db.size).toBe(2); // mesmo estado final — sem duplicação
  });
});

describe("cursor repetido aborta com segurança", () => {
  it("nextCursor repete um cursor já visto -> failSegment(pagination_loop_detected), NÃO laço infinito", async () => {
    const p1 = [row("ad_1", "2026-08-01", 10)];
    const p2 = [row("ad_2", "2026-08-02", 20)];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: p1, nextCursor: "c1" })
      .mockResolvedValueOnce({ rows: p2, nextCursor: "c1" }); // repete o cursor da página 1
    const deps = baseDeps({ fetchPage, upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toMatchObject({ kind: "failed", reason: "pagination_loop_detected", pagesFetched: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(2); // nunca tenta uma 3ª página
    expect(deps.failSegment).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "pagination_loop_detected" }),
    );
  });
});

describe("limite defensivo de páginas (pagination_overflow)", () => {
  it("nextCursor sempre novo, mas excede maxPages -> failSegment(pagination_overflow)", async () => {
    let n = 0;
    const fetchPage = vi.fn(async () => {
      n += 1;
      return { rows: [row(`ad_${n}`, "2026-08-01", 1)], nextCursor: `c${n}` };
    });
    const deps = baseDeps({ fetchPage, upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }) });
    const out = await executeBackfillSegment(task(), deps, { maxPages: 2 });
    expect(out).toMatchObject({ kind: "failed", reason: "pagination_overflow", pagesFetched: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("DEFAULT_MAX_PAGES espelha o default de listEdge (graph.ts) — 200", () => {
    expect(DEFAULT_MAX_PAGES).toBe(200);
  });
});

describe("erro na página 2 — fencing/backoff por categoria", () => {
  it("transient na página 2 -> failSegment com errorClass transient; página 1 já upsertada permanece contabilizada", async () => {
    const p1 = [row("ad_1", "2026-08-01", 10)];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: p1, nextCursor: "c1" })
      .mockRejectedValueOnce(Object.assign(new Error("graph_transient"), { kind: "transient" }));
    const deps = baseDeps({ fetchPage, upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({
      kind: "failed",
      errorClass: "transient",
      reason: "graph_transient",
      pagesFetched: 1,
      rowsWritten: 1,
    });
    expect(deps.failSegment).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "graph_transient" }),
    );
  });

  it("rate_limited -> failSegment com next_retry_at MAIOR que transient (backoff conservador)", async () => {
    const rateDeps = baseDeps({
      fetchPage: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("rl"), { kind: "rate_limited" })),
    });
    const transientDeps = baseDeps({
      fetchPage: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("tr"), { kind: "transient" })),
    });
    await executeBackfillSegment(task(), rateDeps);
    await executeBackfillSegment(task(), transientDeps);
    const rateRetry = (rateDeps.failSegment as ReturnType<typeof vi.fn>).mock.calls[0][0].nextRetryAt;
    const transientRetry = (transientDeps.failSegment as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .nextRetryAt;
    expect(new Date(rateRetry).getTime()).toBeGreaterThan(new Date(transientRetry).getTime());
  });

  it("token_revoked (auth) -> failSegment E markReauthRequired chamado", async () => {
    const markReauthRequired = vi.fn().mockResolvedValue(undefined);
    const deps = baseDeps({
      fetchPage: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("bad_token"), { kind: "token_revoked" })),
      markReauthRequired,
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toMatchObject({ kind: "failed", errorClass: "token_revoked" });
    expect(markReauthRequired).toHaveBeenCalledTimes(1);
  });

  it("insufficient_permission -> failSegment, markReauthRequired NÃO chamado", async () => {
    const markReauthRequired = vi.fn().mockResolvedValue(undefined);
    const deps = baseDeps({
      fetchPage: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("no_perm"), { kind: "insufficient_permission" })),
      markReauthRequired,
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toMatchObject({ kind: "failed", errorClass: "insufficient_permission" });
    expect(markReauthRequired).not.toHaveBeenCalled();
  });

  it("erro sem .kind reconhecível -> classificado como unknown (nunca lança para o chamador)", async () => {
    const deps = baseDeps({ fetchPage: vi.fn().mockRejectedValue(new Error("boom")) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toMatchObject({ kind: "failed", errorClass: "unknown" });
  });
});

describe("ownership perdido — em cada ponto do fluxo", () => {
  it("ANTES do fetch (heartbeat da 1ª página falha) -> refused, fetchPage NUNCA chamado", async () => {
    const deps = baseDeps({ heartbeat: vi.fn().mockResolvedValue(false) });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost", pagesFetched: 0, rowsWritten: 0 });
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });

  it("DEPOIS do fetch e ANTES do write (heartbeat #2 falha) -> refused, upsertRows NUNCA chamado", async () => {
    const heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const rows = [row("ad_1", "2026-08-01", 10)];
    const deps = baseDeps({
      heartbeat,
      fetchPage: vi.fn().mockResolvedValue({ rows, nextCursor: null }),
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost", pagesFetched: 1, rowsWritten: 0 });
    expect(deps.upsertRows).not.toHaveBeenCalled();
    expect(deps.completeSegment).not.toHaveBeenCalled();
  });

  it("ENTRE páginas (heartbeat falha só na 2ª página) -> refused após a 1ª página já escrita", async () => {
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce(true) // pré-fetch pág 1
      .mockResolvedValueOnce(true) // pré-write pág 1
      .mockResolvedValueOnce(false); // pré-fetch pág 2
    const p1 = [row("ad_1", "2026-08-01", 10)];
    const fetchPage = vi.fn().mockResolvedValue({ rows: p1, nextCursor: "c1" });
    const deps = baseDeps({
      heartbeat,
      fetchPage,
      upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }),
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost", pagesFetched: 1, rowsWritten: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1); // nunca tenta a 2ª página
  });

  it("ANTES de complete (completeSegment devolve false) -> refused, NÃO completed", async () => {
    const deps = baseDeps({
      fetchPage: vi.fn().mockResolvedValue({ rows: [row("ad_1", "2026-08-01", 5)], nextCursor: null }),
      upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }),
      completeSegment: vi.fn().mockResolvedValue(false),
    });
    const out = await executeBackfillSegment(task(), deps);
    expect(out).toEqual({ kind: "refused", reason: "ownership_lost", pagesFetched: 1, rowsWritten: 1 });
  });

  it("heartbeat é chamado com (segmentId, leaseToken) corretos, 2x por página", async () => {
    const heartbeat = vi.fn().mockResolvedValue(true);
    const deps = baseDeps({
      heartbeat,
      fetchPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    });
    await executeBackfillSegment(task(), deps);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    for (const call of heartbeat.mock.calls) {
      expect(call).toEqual(["seg-1", "token-current"]);
    }
  });
});

describe("níveis suportados — account/campaign/adset/ad tratados de forma opaca/idêntica", () => {
  const levels: BackfillLevel[] = ["account", "campaign", "adset", "ad"];
  for (const level of levels) {
    it(`level=${level}: mesmo fluxo, level só repassado ao fetchPage`, async () => {
      const fetchPage = vi.fn().mockResolvedValue({ rows: [], nextCursor: null } satisfies FetchPageResult);
      const deps = baseDeps({ fetchPage });
      const out = await executeBackfillSegment(task({ level }), deps);
      expect(out.kind).toBe("skipped_no_data");
      expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ level }));
    });
  }
});

describe("nenhum token em logs/resultados", () => {
  it("outcome nunca carrega leaseToken/token — só campos operacionais seguros", async () => {
    const scenarios: Array<[string, BackfillExecutorDeps]> = [
      ["completed", baseDeps({ fetchPage: vi.fn().mockResolvedValue({ rows: [row("a", "2026-08-01", 1)], nextCursor: null }), upsertRows: vi.fn().mockResolvedValue({ rowsWritten: 1 }) })],
      ["skipped_no_data", baseDeps()],
      ["refused", baseDeps({ isAccountLinked: vi.fn().mockResolvedValue(false) })],
      ["failed", baseDeps({ fetchPage: vi.fn().mockRejectedValue(new Error("x")) })],
    ];
    for (const [, deps] of scenarios) {
      const out = await executeBackfillSegment(task(), deps);
      const json = JSON.stringify(out);
      expect(json).not.toMatch(/token-current|leaseToken|"token"/i);
    }
  });
});

describe("nenhuma chamada real à Meta é possível nesta fase", () => {
  it("fetchPage é 100% injetado — sem fake, nada acontece além do contrato", async () => {
    const calls: string[] = [];
    const deps = baseDeps({
      fetchPage: vi.fn(async () => {
        calls.push("fetchPage chamado");
        return { rows: [], nextCursor: null };
      }),
    });
    await executeBackfillSegment(task(), deps);
    expect(calls).toEqual(["fetchPage chamado"]);
  });

  it("guarda estática: o CÓDIGO de executor.ts não contém nenhuma chamada de rede real", () => {
    const src = readFileSync(fileURLToPath(new URL("../../lib/backfill/executor.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toContain("graph.facebook.com");
    expect(src).not.toMatch(/XMLHttpRequest|axios/);
  });
});
