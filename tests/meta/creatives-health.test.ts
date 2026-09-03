/**
 * creatives_status — regra baseada na SAÚDE da etapa, não em `upserted > 0`.
 * Espelha o CASE de `public.meta_client_sync_health` após a migration
 * 20260903214500_fix_creatives_health_incremental.sql.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateCreativesStatus,
  type CreativeStagePerAccount,
} from "@/lib/meta/sync-health";

const acc = (o: Partial<CreativeStagePerAccount>): CreativeStagePerAccount => ({
  present: true,
  upserted: 0,
  minimalOnly: 0,
  failed: 0,
  degraded: false,
  ...o,
});

describe("creatives_status — casos do spec", () => {
  it("A) 61 novos / 61 upserted -> ok", () => {
    expect(aggregateCreativesStatus([acc({ upserted: 61 })])).toBe("ok");
  });

  it("B) 61 conhecidos / known_skipped / upserted 0 -> ok", () => {
    expect(aggregateCreativesStatus([acc({ upserted: 0 })])).toBe("ok");
  });

  it("C) 30 conhecidos + 31 FULL, sem erro -> ok", () => {
    expect(aggregateCreativesStatus([acc({ upserted: 31 })])).toBe("ok");
  });

  it("D) 0 creatives referenciados, stage sem erro -> ok", () => {
    expect(
      aggregateCreativesStatus([
        acc({ upserted: 0, minimalOnly: 0, failed: 0, degraded: false }),
      ]),
    ).toBe("ok");
  });

  it("E) 60 ok + 1 minimal_only -> partial", () => {
    expect(
      aggregateCreativesStatus([acc({ upserted: 60 }), acc({ upserted: 0, minimalOnly: 1 })]),
    ).toBe("partial");
  });

  it("F) 60 ok + 1 failed -> partial", () => {
    expect(
      aggregateCreativesStatus([acc({ upserted: 60 }), acc({ upserted: 0, failed: 1 })]),
    ).toBe("partial");
  });

  it("degraded=true -> partial", () => {
    expect(aggregateCreativesStatus([acc({ upserted: 10, degraded: true })])).toBe("partial");
  });

  it("stats ausente (nenhuma conta com stats.creatives) -> unknown", () => {
    expect(aggregateCreativesStatus([acc({ present: false }), acc({ present: false })])).toBe(
      "unknown",
    );
  });

  it("falha COMPLETA: todas as contas sem salvar nada + failed -> failed", () => {
    expect(
      aggregateCreativesStatus([acc({ upserted: 0, failed: 3 }), acc({ upserted: 0, failed: 2 })]),
    ).toBe("failed");
  });
});

describe("creatives_status — agregação multi-conta", () => {
  it("ok + ok -> ok", () => {
    expect(aggregateCreativesStatus([acc({ upserted: 5 }), acc({ upserted: 0 })])).toBe("ok");
  });
  it("ok + partial -> partial", () => {
    expect(
      aggregateCreativesStatus([acc({ upserted: 5 }), acc({ upserted: 0, minimalOnly: 2 })]),
    ).toBe("partial");
  });
  it("ok + failed(1 conta) -> partial (a outra salvou)", () => {
    expect(
      aggregateCreativesStatus([acc({ upserted: 9 }), acc({ upserted: 0, failed: 4 })]),
    ).toBe("partial");
  });
  it("independe da ORDEM das contas", () => {
    const a = acc({ upserted: 10 });
    const b = acc({ upserted: 0, failed: 1 });
    const c = acc({ upserted: 0, minimalOnly: 3 });
    expect(aggregateCreativesStatus([a, b, c])).toBe(aggregateCreativesStatus([c, a, b]));
    expect(aggregateCreativesStatus([b, c, a])).toBe(aggregateCreativesStatus([a, b, c]));
    // known_skipped em qualquer posição não muda o "ok"
    expect(aggregateCreativesStatus([acc({ upserted: 0 }), acc({ upserted: 7 })])).toBe(
      aggregateCreativesStatus([acc({ upserted: 7 }), acc({ upserted: 0 })]),
    );
  });
});
