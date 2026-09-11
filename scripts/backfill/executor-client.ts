/**
 * DATA V2.3A — Historical Backfill Rollout. Cliente HTTP do
 * `meta-backfill-executor` (Edge Function, V2.2.3). `fetchImpl` é injetável
 * — testes usam um fake, nunca uma chamada de rede real. Cada chamada
 * processa NO MÁXIMO 1 segmento (contrato já estabelecido na V2.2.3) — este
 * cliente não muda esse contrato, só o invoca.
 */

export interface ExecutorConfig {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export interface ExecutorInvocationResult {
  status: string; // "idle" | "done" | "skipped_no_data" | "failed" | "refused"
  [key: string]: unknown;
}

/** Invoca o executor UMA vez, para `jobId` (reivindica o próximo segmento elegível daquele job, se houver). */
export async function invokeExecutorOnce(
  config: ExecutorConfig,
  args: { jobId: string },
): Promise<ExecutorInvocationResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(config.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-meta-backfill-executor-secret": config.secret,
    },
    body: JSON.stringify({ jobId: args.jobId }),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`executor falhou (${res.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed as ExecutorInvocationResult;
}
