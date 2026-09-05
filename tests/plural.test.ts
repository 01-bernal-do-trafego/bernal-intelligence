import { describe, expect, it } from "vitest";
import { plural, pluralize } from "@/lib/plural";

describe("plural / pluralize — 0 / 1 / N", () => {
  it("1 -> singular; 0 e N -> plural (default + 's')", () => {
    expect(plural(1, "cliente")).toBe("cliente");
    expect(plural(0, "cliente")).toBe("clientes");
    expect(plural(2, "cliente")).toBe("clientes");
    expect(plural(10, "conta")).toBe("contas");
  });

  it("plural irregular explícito", () => {
    expect(plural(1, "precisa", "precisam")).toBe("precisa");
    expect(plural(3, "precisa", "precisam")).toBe("precisam");
  });

  it("pluralize inclui o número", () => {
    expect(pluralize(1, "cliente")).toBe("1 cliente");
    expect(pluralize(2, "cliente")).toBe("2 clientes");
    expect(pluralize(0, "atualizado")).toBe("0 atualizados");
    expect(pluralize(1, "atualizado")).toBe("1 atualizado");
  });

  it("frases operacionais reais da Visão geral", () => {
    expect(`${pluralize(1, "conta")} em ${pluralize(1, "cliente")}`).toBe(
      "1 conta em 1 cliente",
    );
    expect(`${pluralize(3, "conta")} em ${pluralize(2, "cliente")}`).toBe(
      "3 contas em 2 clientes",
    );
    expect(
      `${1} ${plural(1, "cliente")} ${plural(1, "precisa", "precisam")} de atenção`,
    ).toBe("1 cliente precisa de atenção");
    expect(
      `${2} ${plural(2, "cliente")} ${plural(2, "precisa", "precisam")} de atenção`,
    ).toBe("2 clientes precisam de atenção");
  });
});
