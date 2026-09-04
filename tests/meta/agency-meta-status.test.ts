/**
 * Estado Meta agregado do cliente (lib/meta/agency-meta-status.ts) — cliente
 * com N contas / N connections, nunca "a connection mais recente".
 */
import { describe, expect, it } from "vitest";
import { aggregateClientMetaState } from "@/lib/meta/agency-meta-status";

describe("aggregateClientMetaState", () => {
  it("1 connection active, 1 conta vinculada -> connected", () => {
    const state = aggregateClientMetaState(
      [{ connectionId: "c1", status: "active", hasSecret: true }],
      [{ connectionId: "c1", isLinked: true }],
    );
    expect(state).toBe("connected");
  });

  it("active + expiring (2 connections/contas relevantes) -> expiring vence connected", () => {
    const state = aggregateClientMetaState(
      [
        { connectionId: "c1", status: "active", hasSecret: true },
        { connectionId: "c2", status: "expiring", hasSecret: true },
      ],
      [
        { connectionId: "c1", isLinked: true },
        { connectionId: "c2", isLinked: true },
      ],
    );
    expect(state).toBe("expiring");
  });

  it("active + reauthorization_required RELEVANTE -> reconnect vence connected", () => {
    const state = aggregateClientMetaState(
      [
        { connectionId: "c1", status: "active", hasSecret: true },
        { connectionId: "c2", status: "reauthorization_required", hasSecret: true },
      ],
      [
        { connectionId: "c1", isLinked: true },
        { connectionId: "c2", isLinked: true },
      ],
    );
    expect(state).toBe("reconnect");
  });

  it("connection problemática SEM nenhuma conta vinculada -> não polui o status", () => {
    const state = aggregateClientMetaState(
      [
        { connectionId: "c1", status: "active", hasSecret: true },
        // c2 é órfã: nenhuma conta aponta pra ela.
        { connectionId: "c2", status: "revoked", hasSecret: false },
      ],
      [{ connectionId: "c1", isLinked: true }],
    );
    expect(state).toBe("connected");
  });

  it("nenhuma conta vinculada -> sem Meta, mesmo com connections cadastradas", () => {
    const state = aggregateClientMetaState(
      [{ connectionId: "c1", status: "active", hasSecret: true }],
      [], // nenhuma conta is_linked=true
    );
    expect(state).toBe("not_connected");
  });

  it("conta vinculada mas connection_id nulo (órfã) -> sem Meta", () => {
    const state = aggregateClientMetaState(
      [{ connectionId: "c1", status: "active", hasSecret: true }],
      [{ connectionId: null, isLinked: true }],
    );
    expect(state).toBe("not_connected");
  });

  it("múltiplas contas na MESMA connection -> 1 estado só (não duplica avaliação)", () => {
    const state = aggregateClientMetaState(
      [{ connectionId: "c1", status: "expiring", hasSecret: true }],
      [
        { connectionId: "c1", isLinked: true },
        { connectionId: "c1", isLinked: true },
        { connectionId: "c1", isLinked: true },
      ],
    );
    expect(state).toBe("expiring");
  });

  it("revoked tem prioridade sobre expired quando ambas relevantes", () => {
    const state = aggregateClientMetaState(
      [
        { connectionId: "c1", status: "revoked", hasSecret: true },
        { connectionId: "c2", status: "expired", hasSecret: true },
      ],
      [
        { connectionId: "c1", isLinked: true },
        { connectionId: "c2", isLinked: true },
      ],
    );
    expect(state).toBe("revoked");
  });

  it("has_secret=false conta como reconnect mesmo com status 'active'", () => {
    const state = aggregateClientMetaState(
      [{ connectionId: "c1", status: "active", hasSecret: false }],
      [{ connectionId: "c1", isLinked: true }],
    );
    expect(state).toBe("reconnect");
  });
});
