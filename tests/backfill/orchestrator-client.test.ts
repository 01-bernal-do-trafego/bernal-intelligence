import { describe, expect, it, vi } from "vitest";
import { createJob, getJobStatus, inspectAccount } from "../../scripts/backfill/orchestrator-client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const CONFIG = { baseUrl: "https://example.test/orchestrator", secret: "shh" };

describe("inspectAccount", () => {
  it("envia action=inspect + header do secret, devolve o corpo parseado", async () => {
    const fetchImpl = fakeFetch(200, { clientId: "c1", adAccountRef: "a1" });
    const result = await inspectAccount({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    expect(result).toEqual({ clientId: "c1", adAccountRef: "a1" });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(CONFIG.baseUrl);
    expect((init.headers as Record<string, string>)["x-meta-backfill-orchestrator-secret"]).toBe("shh");
    expect(JSON.parse(init.body as string)).toEqual({ action: "inspect", clientId: "c1", adAccountRef: "a1" });
  });

  it("resposta não-ok -> lança erro (nunca engole silenciosamente)", async () => {
    const fetchImpl = fakeFetch(404, { error: "client_not_found" });
    await expect(inspectAccount({ ...CONFIG, fetchImpl }, { clientId: "x", adAccountRef: "y" })).rejects.toThrow(
      /inspect falhou \(404\)/,
    );
  });

  it("nunca chama fetch real — usa SOMENTE fetchImpl injetado", async () => {
    const fetchImpl = fakeFetch(200, {});
    await inspectAccount({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createJob", () => {
  it("envia action=create com o payload completo", async () => {
    const fetchImpl = fakeFetch(200, { jobId: "job-1", segmentCount: 2 });
    const result = await createJob(
      { ...CONFIG, fetchImpl },
      {
        clientId: "c1",
        adAccountRef: "a1",
        requestedLevels: ["account"],
        targetStartDate: "2026-08-01",
        targetEndDate: "2026-08-31",
        segments: [{ level: "account", dateFrom: "2026-08-01", dateTo: "2026-08-31" }],
      },
    );
    expect(result).toEqual({ jobId: "job-1", segmentCount: 2 });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("create");
    expect(body.segments).toHaveLength(1);
  });

  it("erro da RPC (409) -> lança com detail", async () => {
    const fetchImpl = fakeFetch(409, { error: "create_failed", detail: "overlap" });
    await expect(
      createJob(
        { ...CONFIG, fetchImpl },
        {
          clientId: "c1",
          adAccountRef: "a1",
          requestedLevels: ["account"],
          targetStartDate: "2026-08-01",
          targetEndDate: "2026-08-31",
          segments: [],
        },
      ),
    ).rejects.toThrow(/create falhou \(409\)/);
  });
});

describe("getJobStatus", () => {
  it("envia action=status com jobId", async () => {
    const fetchImpl = fakeFetch(200, { jobId: "job-1", jobStatus: "running" });
    const result = await getJobStatus({ ...CONFIG, fetchImpl }, { jobId: "job-1" });
    expect(result).toEqual({ jobId: "job-1", jobStatus: "running" });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ action: "status", jobId: "job-1" });
  });
});

describe("secret nunca aparece no corpo da requisição — só no header", () => {
  it("o body JSON não contém o secret em nenhuma chamada", async () => {
    const fetchImpl = fakeFetch(200, {});
    await inspectAccount({ ...CONFIG, fetchImpl }, { clientId: "c1", adAccountRef: "a1" });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body as string).not.toContain("shh");
  });
});
