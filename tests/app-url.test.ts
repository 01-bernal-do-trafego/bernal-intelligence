/**
 * `lib/app-url.ts` — origem pública autoritativa atrás de reverse proxy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appOrigin,
  configuredAppOrigin,
  hasConfiguredAppOrigin,
} from "@/lib/app-url";

const ENV = "NEXT_PUBLIC_APP_URL";
let original: string | undefined;

beforeEach(() => {
  original = process.env[ENV];
  delete process.env[ENV];
});
afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

const req = (origin: string) => ({ nextUrl: { origin } });

describe("configuredAppOrigin", () => {
  it("ausente -> string vazia", () => {
    expect(configuredAppOrigin()).toBe("");
    expect(hasConfiguredAppOrigin()).toBe(false);
  });

  it("usa NEXT_PUBLIC_APP_URL quando presente", () => {
    process.env[ENV] = "https://dashboard.bernaldotrafego.com.br";
    expect(configuredAppOrigin()).toBe("https://dashboard.bernaldotrafego.com.br");
    expect(hasConfiguredAppOrigin()).toBe(true);
  });

  it("remove a barra final", () => {
    process.env[ENV] = "https://dashboard.bernaldotrafego.com.br/";
    expect(configuredAppOrigin()).toBe("https://dashboard.bernaldotrafego.com.br");
  });

  it("descarta path/query/hash, mantém a porta", () => {
    process.env[ENV] = "https://app.exemplo.com:8443/qualquer/coisa?x=1#y";
    expect(configuredAppOrigin()).toBe("https://app.exemplo.com:8443");
  });

  it("espaços em volta são ignorados", () => {
    process.env[ENV] = "  https://dashboard.bernaldotrafego.com.br  ";
    expect(configuredAppOrigin()).toBe("https://dashboard.bernaldotrafego.com.br");
  });

  it("valor não-URL: só tira a barra final (fallback defensivo)", () => {
    process.env[ENV] = "dashboard.bernaldotrafego.com.br/";
    expect(configuredAppOrigin()).toBe("dashboard.bernaldotrafego.com.br");
  });
});

describe("appOrigin", () => {
  it("NEXT_PUBLIC_APP_URL vence a origem do request", () => {
    process.env[ENV] = "https://dashboard.bernaldotrafego.com.br";
    expect(appOrigin(req("https://0.0.0.0:3000"))).toBe(
      "https://dashboard.bernaldotrafego.com.br",
    );
  });

  it("nunca cai em 0.0.0.0 quando NEXT_PUBLIC_APP_URL está configurada", () => {
    process.env[ENV] = "https://dashboard.bernaldotrafego.com.br";
    expect(appOrigin(req("https://0.0.0.0:3000"))).not.toContain("0.0.0.0");
    expect(appOrigin(req("http://0.0.0.0:3000"))).not.toContain("0.0.0.0");
  });

  it("sem a variável: fallback para a origem do request (dev)", () => {
    expect(appOrigin(req("http://localhost:3000"))).toBe("http://localhost:3000");
  });

  it("monta um Location público correto no callback", () => {
    process.env[ENV] = "https://dashboard.bernaldotrafego.com.br";
    const origin = appOrigin(req("https://0.0.0.0:3000"));
    const location = new URL(
      "/clients/abc?meta=error&reason=exchange",
      origin,
    ).toString();
    expect(location).toBe(
      "https://dashboard.bernaldotrafego.com.br/clients/abc?meta=error&reason=exchange",
    );
  });
});
