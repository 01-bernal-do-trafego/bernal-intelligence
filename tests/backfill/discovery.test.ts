import { describe, expect, it } from "vitest";
import { resolveEarliestDate } from "@/lib/backfill/discovery";

describe("discovery foundation — resolução de resolvedEarliestDate", () => {
  it("sem nenhuma base conhecida -> unresolved (nunca inventa data)", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: null,
      earliestKnownCampaignCreatedTime: null,
      consecutiveEmptyBlocks: 0,
      emptyBlockThreshold: 3,
    });
    expect(out).toEqual({ kind: "unresolved" });
  });

  it("campanha mais antiga conhecida tem prioridade sobre account.created_time", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: "2020-01-01",
      earliestKnownCampaignCreatedTime: "2023-05-10",
      consecutiveEmptyBlocks: 0,
      emptyBlockThreshold: 3,
    });
    expect(out).toEqual({ kind: "resolved", earliestDate: "2023-05-10", source: "campaign" });
  });

  it("sem campanha conhecida, cai para account.created_time", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: "2020-01-01",
      earliestKnownCampaignCreatedTime: null,
      consecutiveEmptyBlocks: 0,
      emptyBlockThreshold: 3,
    });
    expect(out).toEqual({ kind: "resolved", earliestDate: "2020-01-01", source: "account" });
  });

  it("blocos vazios consecutivos abaixo do limiar -> ainda resolved, não exhausted", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: null,
      earliestKnownCampaignCreatedTime: "2023-05-10",
      consecutiveEmptyBlocks: 2,
      emptyBlockThreshold: 3,
    });
    expect(out.kind).toBe("resolved");
  });

  it("blocos vazios consecutivos >= limiar -> exhausted, com a base conhecida", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: "2020-01-01",
      earliestKnownCampaignCreatedTime: "2023-05-10",
      consecutiveEmptyBlocks: 3,
      emptyBlockThreshold: 3,
    });
    expect(out).toEqual({ kind: "exhausted", earliestDate: "2023-05-10", source: "campaign" });
  });

  it("exhausted sem NENHUMA base conhecida ainda fica unresolved (nada para ancorar)", () => {
    const out = resolveEarliestDate({
      accountCreatedTime: null,
      earliestKnownCampaignCreatedTime: null,
      consecutiveEmptyBlocks: 5,
      emptyBlockThreshold: 3,
    });
    expect(out).toEqual({ kind: "unresolved" });
  });
});
