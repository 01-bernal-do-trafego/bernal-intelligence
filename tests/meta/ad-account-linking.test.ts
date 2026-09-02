import { describe, expect, it } from "vitest";
import {
  diffLinkSelection,
  partitionLinkRequest,
  planLinkTransfer,
  type DiscoveryRow,
  type LinkableRowLike,
} from "@/lib/meta/ad-account-linking";

const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONN_OLD = "c0000000-0000-4000-8000-000000000001";
const CONN_OLD2 = "c0000000-0000-4000-8000-000000000002";
const CONN_NEW = "c0000000-0000-4000-8000-00000000000f";

const rows: LinkableRowLike[] = [
  { adAccountId: "act_1", clientId: CLIENT_A, isLinked: false },
  { adAccountId: "act_2", clientId: CLIENT_A, isLinked: true },
  { adAccountId: "act_3", clientId: CLIENT_A, isLinked: false },
  // conta descoberta E linkada para OUTRO cliente
  { adAccountId: "act_9", clientId: CLIENT_B, isLinked: true },
  // conta descoberta pelo cliente A também, mas linkada no B
  { adAccountId: "act_9", clientId: CLIENT_A, isLinked: false },
];

describe("partitionLinkRequest", () => {
  it("seleção de múltiplas contas do próprio cliente => todas linkáveis", () => {
    const r = partitionLinkRequest({
      requestedIds: ["act_1", "act_2", "act_3"],
      clientId: CLIENT_A,
      rows,
    });
    expect(r.linkable.sort()).toEqual(["act_1", "act_2", "act_3"]);
    expect(r.blocked).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("vincular conta linkada a OUTRO cliente => bloqueada", () => {
    const r = partitionLinkRequest({
      requestedIds: ["act_1", "act_9"],
      clientId: CLIENT_A,
      rows,
    });
    expect(r.linkable).toEqual(["act_1"]);
    expect(r.blocked).toEqual([
      { adAccountId: "act_9", ownedByClientId: CLIENT_B },
    ]);
  });

  it("id não descoberto para o cliente => unknown", () => {
    const r = partitionLinkRequest({
      requestedIds: ["act_1", "act_404"],
      clientId: CLIENT_A,
      rows,
    });
    expect(r.linkable).toEqual(["act_1"]);
    expect(r.unknown).toEqual(["act_404"]);
  });

  it("dedup dos ids pedidos", () => {
    const r = partitionLinkRequest({
      requestedIds: ["act_1", "act_1", "act_1"],
      clientId: CLIENT_A,
      rows,
    });
    expect(r.linkable).toEqual(["act_1"]);
  });
});

describe("diffLinkSelection", () => {
  it("calcula link/unlink/unchanged", () => {
    expect(
      diffLinkSelection({
        currentlyLinked: ["act_2", "act_5"],
        desired: ["act_2", "act_3"],
      }),
    ).toEqual({
      toLink: ["act_3"],
      toUnlink: ["act_5"],
      unchanged: ["act_2"],
    });
  });

  it("re-salvar a mesma seleção => nada a fazer (idempotente)", () => {
    expect(
      diffLinkSelection({
        currentlyLinked: ["act_2", "act_3"],
        desired: ["act_3", "act_2"],
      }),
    ).toEqual({ toLink: [], toUnlink: [], unchanged: ["act_3", "act_2"] });
  });

  it("desmarcar tudo => só unlink", () => {
    expect(
      diffLinkSelection({ currentlyLinked: ["act_1", "act_2"], desired: [] }),
    ).toEqual({ toLink: [], toUnlink: ["act_1", "act_2"], unchanged: [] });
  });
});

describe("planLinkTransfer — reconexão", () => {
  it("reconexão simples: act_123 linkada na conexão antiga -> transfere p/ a nova", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_123", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_123", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_123"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.blocked).toEqual([]);
    expect(plan.unknown).toEqual([]);
    expect(plan.link).toEqual(["act_123"]);
    expect(plan.releaseFromOtherConnections).toEqual([
      { adAccountId: "act_123", connectionId: CONN_OLD },
    ]);
    expect(plan.unlinkOnTarget).toEqual([]);
  });

  it("reconectar várias vezes: solta o vínculo em TODAS as conexões antigas", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_9", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_9", clientId: CLIENT_A, connectionId: CONN_OLD2, isLinked: true },
      { adAccountId: "act_9", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_9"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.link).toEqual(["act_9"]);
    expect(plan.releaseFromOtherConnections).toEqual([
      { adAccountId: "act_9", connectionId: CONN_OLD },
      { adAccountId: "act_9", connectionId: CONN_OLD2 },
    ]);
  });

  it("conexão antiga REMOVIDA (connection_id null): ainda transfere", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: null, isLinked: true },
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.releaseFromOtherConnections).toEqual([
      { adAccountId: "act_1", connectionId: null },
    ]);
    expect(plan.link).toEqual(["act_1"]);
  });

  it("conexão antiga revogada não muda nada: transferência é por client_id + connection_id", () => {
    // a linha antiga continua com o connection_id revogado; o plano só olha o par
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.releaseFromOtherConnections).toEqual([
      { adAccountId: "act_1", connectionId: CONN_OLD },
    ]);
  });

  it("conta REMOVIDA da nova autorização: não está na descoberta da conexão-alvo => unknown", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      // a conexão nova só descobriu act_2
      { adAccountId: "act_2", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1", "act_2"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.unknown).toEqual(["act_1"]);
    expect(plan.link).toEqual(["act_2"]);
  });

  it("múltiplas contas vinculadas ao mesmo cliente: transfere todas de uma vez", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_2", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_3", clientId: CLIENT_A, connectionId: CONN_OLD, isLinked: false },
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
      { adAccountId: "act_2", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
      { adAccountId: "act_3", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1", "act_2", "act_3"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.link.sort()).toEqual(["act_1", "act_2", "act_3"]);
    expect(
      plan.releaseFromOtherConnections.map((r) => r.adAccountId).sort(),
    ).toEqual(["act_1", "act_2"]);
  });

  it("conta linkada a OUTRO cliente continua bloqueada (não transfere)", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_x", clientId: CLIENT_B, connectionId: CONN_OLD, isLinked: true },
      { adAccountId: "act_x", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: false },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_x"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.blocked).toEqual([
      { adAccountId: "act_x", ownedByClientId: CLIENT_B },
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.releaseFromOtherConnections).toEqual([]);
  });

  it("desmarcar na conexão-alvo: sai de is_linked sem tocar em outras conexões", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: true },
      { adAccountId: "act_2", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: true },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan.link).toEqual(["act_1"]);
    expect(plan.unlinkOnTarget).toEqual(["act_2"]);
    expect(plan.releaseFromOtherConnections).toEqual([]);
  });

  it("re-salvar a mesma conta na mesma conexão: nada a soltar, nada a desvincular", () => {
    const rows: DiscoveryRow[] = [
      { adAccountId: "act_1", clientId: CLIENT_A, connectionId: CONN_NEW, isLinked: true },
    ];
    const plan = planLinkTransfer({
      requestedIds: ["act_1"],
      clientId: CLIENT_A,
      connectionId: CONN_NEW,
      rows,
    });
    expect(plan).toEqual({
      blocked: [],
      unknown: [],
      releaseFromOtherConnections: [],
      link: ["act_1"],
      unlinkOnTarget: [],
    });
  });
});
