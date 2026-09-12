import { describe, expect, it, vi } from "vitest";
import { discoverAccountHistory } from "../../scripts/backfill/discovery-client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const CONFIG = { baseUrl: "https://example.test/discovery", secret: "disc-shh" };

describe("discoverAccountHistory", () => {
  it("envia {clientId, adAccountRef} + header do secret, devolve o corpo parseado", async () => {
    const fetchImpl = fakeFetch(200, { status: "found", earliestDate: "2024-01-01" });
    const result = await discoverAccountHistory({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    expect(result).toEqual({ status: "found", earliestDate: "2024-01-01" });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(CONFIG.baseUrl);
    expect((init.headers as Record<string, string>)["x-meta-backfill-discovery-secret"]).toBe("disc-shh");
    expect(JSON.parse(init.body as string)).toEqual({ clientId: "c1", adAccountRef: "a1" });
  });

  it("resposta não-ok -> lança erro (nunca engole silenciosamente)", async () => {
    const fetchImpl = fakeFetch(409, { error: "connection_not_eligible" });
    await expect(discoverAccountHistory({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" })).rejects.toThrow(
      /discovery falhou \(409\)/,
    );
  });

  it("no_history é uma resposta 200 normal, não um erro", async () => {
    const fetchImpl = fakeFetch(200, { status: "no_history", earliestDate: null });
    const result = await discoverAccountHistory({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    expect(result.status).toBe("no_history");
  });

  it("secret nunca aparece no corpo — só no header", async () => {
    const fetchImpl = fakeFetch(200, { status: "no_history" });
    await discoverAccountHistory({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body as string).not.toContain("disc-shh");
  });

  it("nunca chama fetch real — usa SOMENTE fetchImpl injetado", async () => {
    const fetchImpl = fakeFetch(200, { status: "no_history" });
    await discoverAccountHistory({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
