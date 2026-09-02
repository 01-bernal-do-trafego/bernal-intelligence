import { describe, expect, it } from "vitest";
import {
  ARCHIVE_STATUS,
  MAX_NAME_LENGTH,
  parseClientInput,
} from "@/lib/client-input";

const base = { name: "Cliente X", internalName: "", status: "onboarding" };

describe("parseClientInput — criação e edição", () => {
  it("aceita entrada válida e apara o nome", () => {
    const result = parseClientInput({ ...base, name: "  Acme Digital  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Acme Digital");
      expect(result.value.status).toBe("onboarding");
    }
  });

  it("nome obrigatório: string vazia é rejeitada", () => {
    expect(parseClientInput({ ...base, name: "" })).toEqual({
      ok: false,
      error: "Informe o nome do cliente.",
    });
  });

  it("nome obrigatório: apenas espaços é rejeitado", () => {
    expect(parseClientInput({ ...base, name: "    " }).ok).toBe(false);
  });

  it("nome acima do limite é rejeitado", () => {
    const result = parseClientInput({
      ...base,
      name: "a".repeat(MAX_NAME_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("identificação interna vazia vira null", () => {
    const result = parseClientInput({ ...base, internalName: "   " });
    expect(result.ok && result.value.internalName).toBe(null);
  });

  it("identificação interna é aparada", () => {
    const result = parseClientInput({ ...base, internalName: "  Interno  " });
    expect(result.ok && result.value.internalName).toBe("Interno");
  });

  it("edição: aceita todos os status válidos", () => {
    for (const status of ["onboarding", "active", "paused", "archived"]) {
      expect(parseClientInput({ ...base, status }).ok).toBe(true);
    }
  });

  it("status inválido é rejeitado (frontend não escolhe valores livres)", () => {
    expect(parseClientInput({ ...base, status: "deleted" }).ok).toBe(false);
    expect(parseClientInput({ ...base, status: "" }).ok).toBe(false);
  });
});

describe("arquivamento", () => {
  it("arquivar apenas define o status como 'archived'", () => {
    expect(ARCHIVE_STATUS).toBe("archived");
  });
});
