import { describe, expect, it } from "vitest";
import { APP_ROLES, ROLE_LABEL, isAgencyRole, parseRole } from "@/lib/roles";

describe("isAgencyRole", () => {
  it("reconhece a equipe Bernal", () => {
    expect(isAgencyRole("agency_admin")).toBe(true);
    expect(isAgencyRole("agency_member")).toBe(true);
  });

  it("nega client_user e valores ausentes", () => {
    expect(isAgencyRole("client_user")).toBe(false);
    expect(isAgencyRole(null)).toBe(false);
    expect(isAgencyRole(undefined)).toBe(false);
  });
});

describe("parseRole", () => {
  it("aceita apenas os três papéis conhecidos", () => {
    for (const role of APP_ROLES) {
      expect(parseRole(role)).toBe(role);
    }
  });

  it("rejeita qualquer outra coisa (blinda contra role vindo do cliente/banco)", () => {
    expect(parseRole("root")).toBeNull();
    expect(parseRole("admin")).toBeNull();
    expect(parseRole("")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
    expect(parseRole(42)).toBeNull();
    expect(parseRole({ role: "agency_admin" })).toBeNull();
  });
});

describe("ROLE_LABEL", () => {
  it("tem rótulo para todos os papéis", () => {
    for (const role of APP_ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
    }
  });
});
