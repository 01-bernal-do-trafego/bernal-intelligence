import { describe, expect, it, vi } from "vitest";
import { invokeExecutorOnce } from "../../scripts/backfill/executor-client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const CONFIG = { baseUrl: "https://example.test/executor", secret: "exec-shh" };

describe("invokeExecutorOnce", () => {
  it("envia { jobId } + header do secret, devolve o resultado", async () => {
    const fetchImpl = fakeFetch(200, { status: "done", rowsWritten: 5 });
    const result = await invokeExecutorOnce({ ...CONFIG, fetchImpl }, { jobId: "job-1" });
    expect(result).toEqual({ status: "done", rowsWritten: 5 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(CONFIG.baseUrl);
    expect((init.headers as Record<string, string>)["x-meta-backfill-executor-secret"]).toBe("exec-shh");
    expect(JSON.parse(init.body as string)).toEqual({ jobId: "job-1" });
  });

  it('status="idle" NÃO é tratado como erro (200 OK, resposta normal)', async () => {
    const fetchImpl = fakeFetch(200, { status: "idle" });
    const result = await invokeExecutorOnce({ ...CONFIG, fetchImpl }, { jobId: "job-1" });
    expect(result.status).toBe("idle");
  });

  it("resposta não-ok -> lança erro", async () => {
    const fetchImpl = fakeFetch(401, { error: "unauthorized" });
    await expect(invokeExecutorOnce({ ...CONFIG, fetchImpl }, { jobId: "job-1" })).rejects.toThrow(/executor falhou \(401\)/);
  });

  it("secret nunca aparece no corpo — só no header", async () => {
    const fetchImpl = fakeFetch(200, { status: "idle" });
    await invokeExecutorOnce({ ...CONFIG, fetchImpl }, { jobId: "job-1" });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body as string).not.toContain("exec-shh");
  });

  it("nunca chama fetch real — usa SOMENTE fetchImpl injetado", async () => {
    const fetchImpl = fakeFetch(200, { status: "idle" });
    await invokeExecutorOnce({ ...CONFIG, fetchImpl }, { jobId: "job-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
