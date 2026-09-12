/**
 * DATA V2.3B — teste Deno REAL (confirmatório, não exaustivo — a suíte
 * completa vive em `tests/backfill/earliest-date-discovery.test.ts`, Vitest)
 * de `discovery-algorithm.ts`, rodando no MESMO runtime da Edge Function.
 *
 * Rodar: `deno test supabase/functions/_shared/discovery-algorithm.test.ts`
 */
import { strictEqual } from "node:assert/strict";
import { DEFAULT_MAX_DISCOVERY_PROBES, discoverEarliestDate, type ProbeFn } from "./discovery-algorithm.ts";

function fakeProbe(datesWithData: readonly string[]): ProbeFn {
  const set = new Set(datesWithData);
  return async (range) => {
    for (const d of set) {
      if (d >= range.since && d <= range.until) return { hasData: true };
    }
    return { hasData: false };
  };
}

Deno.test("found — binary search encontra a data exata dentro de um range de 1 ano", async () => {
  const out = await discoverEarliestDate({
    accountCreatedDate: "2023-01-01",
    latestClosedDate: "2023-12-31",
    probe: fakeProbe(["2023-06-15"]),
  });
  strictEqual(out.status, "found");
  if (out.status === "found") strictEqual(out.earliestDate, "2023-06-15");
});

Deno.test("no_history — range inteiro sem dado, 1 único probe", async () => {
  let calls = 0;
  const probe: ProbeFn = async () => {
    calls += 1;
    return { hasData: false };
  };
  const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-12-31", probe });
  strictEqual(out.status, "no_history");
  strictEqual(calls, 1);
});

Deno.test("fallback chunked — range_rejected não vira no_history, refina dentro do bloco certo", async () => {
  let call = 0;
  const probe: ProbeFn = async (range) => {
    call += 1;
    if (call === 1) return { hasData: false, errorKind: "range_rejected" };
    return range.since <= "2021-08-10" && "2021-08-10" <= range.until ? { hasData: true } : { hasData: false };
  };
  const out = await discoverEarliestDate({
    accountCreatedDate: "2020-01-01",
    latestClosedDate: "2022-12-31",
    probe,
    chunkDays: 180,
  });
  strictEqual(out.status, "found");
  if (out.status === "found") {
    strictEqual(out.earliestDate, "2021-08-10");
    strictEqual(out.strategy, "chunked");
  }
});

Deno.test("SÓ range_rejected aciona o fallback — token_revoked no probe inicial falha direto, NUNCA fallback", async () => {
  let calls = 0;
  const probe: ProbeFn = async () => {
    calls += 1;
    return { hasData: false, errorKind: "token_revoked" };
  };
  const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2022-12-31", probe });
  strictEqual(out.status, "probe_error");
  if (out.status === "probe_error") strictEqual(out.errorKind, "token_revoked");
  strictEqual(calls, 1); // nunca tenta um 2º bloco
});

Deno.test("SÓ range_rejected aciona o fallback — rate_limited no probe inicial falha direto, NUNCA fallback", async () => {
  let calls = 0;
  const probe: ProbeFn = async () => {
    calls += 1;
    return { hasData: false, errorKind: "rate_limited" };
  };
  const out = await discoverEarliestDate({ accountCreatedDate: "2020-01-01", latestClosedDate: "2022-12-31", probe });
  strictEqual(out.status, "probe_error");
  if (out.status === "probe_error") strictEqual(out.errorKind, "rate_limited");
  strictEqual(calls, 1);
});

Deno.test("MAX_DISCOVERY_PROBES nunca é excedido — para com probe_limit_exceeded, nunca loop infinito", async () => {
  let call = 0;
  const probe: ProbeFn = async () => {
    call += 1;
    return call === 1 ? { hasData: false, errorKind: "range_rejected" } : { hasData: false };
  };
  const out = await discoverEarliestDate({
    accountCreatedDate: "1990-01-01",
    latestClosedDate: "2026-09-10",
    probe,
    maxProbes: 5,
    chunkDays: 30,
  });
  strictEqual(out.status, "probe_limit_exceeded");
  strictEqual(call, 5);
});

Deno.test("confirmação do dia exato — falha vira confirmation_failed, nunca 'found' forçado", async () => {
  const probe: ProbeFn = async (range) => {
    if (range.since === range.until) return { hasData: false };
    return { hasData: true };
  };
  const out = await discoverEarliestDate({ accountCreatedDate: "2024-01-01", latestClosedDate: "2024-01-10", probe });
  strictEqual(out.status, "confirmation_failed");
});

Deno.test("DEFAULT_MAX_DISCOVERY_PROBES é 60 (mesmo valor documentado do espelho Node)", () => {
  strictEqual(DEFAULT_MAX_DISCOVERY_PROBES, 60);
});
