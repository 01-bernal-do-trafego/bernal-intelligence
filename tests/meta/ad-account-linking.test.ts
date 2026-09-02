import { describe, expect, it } from "vitest";
import {
  diffLinkSelection,
  partitionLinkRequest,
  type LinkableRowLike,
} from "@/lib/meta/ad-account-linking";

const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
