import { describe, expect, it } from "vitest";
import {
  accountStatusLabel,
  mergeAdAccountPages,
  normalizeAdAccountId,
  parseAdAccountNode,
} from "@/lib/meta/ad-account";

const node = (over: Record<string, unknown> = {}) => ({
  id: "act_1001",
  account_id: "1001",
  name: "Conta Principal",
  account_status: 1,
  currency: "BRL",
  timezone_name: "America/Sao_Paulo",
  timezone_offset_hours_utc: -3, // presente no retorno da Meta, mas NÃO persistido
  business: { id: "bm_9", name: "BM Atacado" },
  ...over,
});

describe("normalizeAdAccountId", () => {
  it("aceita act_<n> e id numérico cru; rejeita o resto", () => {
    expect(normalizeAdAccountId("act_123")).toBe("act_123");
    expect(normalizeAdAccountId("123")).toBe("act_123");
    expect(normalizeAdAccountId("")).toBeNull();
    expect(normalizeAdAccountId("abc")).toBeNull();
    expect(normalizeAdAccountId(42)).toBeNull();
  });
});

describe("parseAdAccountNode", () => {
  it("uma conta — mapeia os campos persistidos (sem offset numérico)", () => {
    const parsed = parseAdAccountNode(node());
    expect(parsed).toEqual({
      adAccountId: "act_1001",
      name: "Conta Principal",
      accountStatus: 1,
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
      businessId: "bm_9",
      businessName: "BM Atacado",
    });
    expect(parsed).not.toHaveProperty("timezoneOffsetUtc");
  });

  it("ignora timezone_offset_hours_utc (mesmo fracionário) — não persistimos offset", () => {
    const r = parseAdAccountNode(
      node({ timezone_offset_hours_utc: 5.5, account_status: "2" }),
    );
    expect(r).not.toHaveProperty("timezoneOffsetUtc");
    expect(r?.timezoneName).toBe("America/Sao_Paulo");
    expect(r?.accountStatus).toBe(2);
  });

  it("sem business e sem nome — vira null, não quebra", () => {
    const r = parseAdAccountNode({ id: "act_7", account_status: 1 });
    expect(r).toEqual({
      adAccountId: "act_7",
      name: null,
      accountStatus: 1,
      currency: null,
      timezoneName: null,
      businessId: null,
      businessName: null,
    });
  });

  it("nó inválido (sem id utilizável) => null, nunca inventa conta", () => {
    expect(parseAdAccountNode({ name: "x" })).toBeNull();
    expect(parseAdAccountNode(null)).toBeNull();
    expect(parseAdAccountNode("act_1")).toBeNull();
  });
});

describe("mergeAdAccountPages", () => {
  it("nenhuma conta", () => {
    expect(mergeAdAccountPages([[]])).toEqual([]);
    expect(mergeAdAccountPages([])).toEqual([]);
  });

  it("múltiplas contas numa página", () => {
    const out = mergeAdAccountPages([
      [node({ id: "act_1" }), node({ id: "act_2" }), node({ id: "act_3" })],
    ]);
    expect(out.map((a) => a.adAccountId)).toEqual(["act_1", "act_2", "act_3"]);
  });

  it("paginação — junta as páginas na ordem", () => {
    const out = mergeAdAccountPages([
      [node({ id: "act_1" }), node({ id: "act_2" })],
      [node({ id: "act_3" })],
      [node({ id: "act_4" })],
    ]);
    expect(out.map((a) => a.adAccountId)).toEqual([
      "act_1",
      "act_2",
      "act_3",
      "act_4",
    ]);
  });

  it("conta duplicada entre páginas — mantém a primeira, não duplica", () => {
    const out = mergeAdAccountPages([
      [node({ id: "act_1", name: "Original" })],
      [node({ id: "act_1", name: "Repetida" }), node({ id: "act_2" })],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ adAccountId: "act_1", name: "Original" });
    expect(out[1].adAccountId).toBe("act_2");
  });

  it("descarta nós inválidos no meio das páginas", () => {
    const out = mergeAdAccountPages([
      [node({ id: "act_1" }), { junk: true }, null],
      ["nope", node({ id: "act_2" })],
    ]);
    expect(out.map((a) => a.adAccountId)).toEqual(["act_1", "act_2"]);
  });
});

describe("accountStatusLabel", () => {
  it("traduz códigos conhecidos e degrada com o número", () => {
    expect(accountStatusLabel(1)).toBe("Ativa");
    expect(accountStatusLabel(2)).toBe("Desativada");
    expect(accountStatusLabel(101)).toBe("Fechada");
    expect(accountStatusLabel(999)).toBe("Código 999");
    expect(accountStatusLabel(null)).toBe("Desconhecido");
  });
});
