import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  buildTokenExchangeUrl,
} from "@/lib/meta/oauth-url";

const AUTH_INPUT = {
  loginBase: "https://www.facebook.com",
  version: "v26.0",
  appId: "1234567890",
  configId: "999888777",
  redirectUri: "http://localhost:3000/api/meta/oauth/callback",
  state: "nonce-abc",
};

describe("buildAuthorizationUrl", () => {
  it("aponta para {loginBase}/{version}/dialog/oauth", () => {
    const url = new URL(buildAuthorizationUrl(AUTH_INPUT));
    expect(url.origin + url.pathname).toBe(
      "https://www.facebook.com/v26.0/dialog/oauth",
    );
  });

  it("usa config_id no lugar de scope e força o grant de código", () => {
    const url = new URL(buildAuthorizationUrl(AUTH_INPUT));
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("config_id")).toBe("999888777");
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe(AUTH_INPUT.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce-abc");
  });

  it("não duplica barra quando loginBase termina com /", () => {
    const url = buildAuthorizationUrl({
      ...AUTH_INPUT,
      loginBase: "https://www.facebook.com/",
    });
    expect(url).toContain("https://www.facebook.com/v26.0/dialog/oauth?");
  });
});

describe("buildTokenExchangeUrl", () => {
  it("monta o GET /oauth/access_token com secret e redirect_uri idêntico", () => {
    const url = new URL(
      buildTokenExchangeUrl({
        graphBase: "https://graph.facebook.com",
        version: "v26.0",
        appId: "1234567890",
        appSecret: "s3cr3t",
        redirectUri: AUTH_INPUT.redirectUri,
        code: "the-code",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://graph.facebook.com/v26.0/oauth/access_token",
    );
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("client_secret")).toBe("s3cr3t");
    expect(url.searchParams.get("redirect_uri")).toBe(AUTH_INPUT.redirectUri);
    expect(url.searchParams.get("code")).toBe("the-code");
  });
});
