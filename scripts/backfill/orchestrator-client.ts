/**
 * DATA V2.3A — Historical Backfill Rollout. Cliente HTTP do
 * `meta-backfill-orchestrator` (Edge Function, V2.3A). `fetchImpl` é
 * injetável — testes usam um fake, nunca uma chamada de rede real.
 */
import type { BackfillLevel } from "@/lib/backfill/types";

export interface OrchestratorConfig {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export interface InspectResult {
  clientId: string;
  adAccountRef: string;
  metaAccountId: string;
  connectionStatus: string;
  connectionEligible: boolean;
  entityCounts: { account: number; campaign: number; adset: number; ad: number };
  activeJob: boolean;
  jobId: string | null;
  currentSyncRunning: boolean;
}

export interface CreateJobResult {
  jobId: string;
  segmentCount: number;
  status: string;
  range: { from: string; to: string };
  levels: readonly BackfillLevel[];
}

export interface StatusResult {
  jobId: string;
  jobStatus: string;
  totalSegments: number;
  pending: number;
  running: number;
  done: number;
  skippedNoData: number;
  failed: number;
  dateFrom: string;
  dateTo: string;
  levels: readonly BackfillLevel[];
  progressPct: number | null;
}

async function callOrchestrator(config: OrchestratorConfig, body: Record<string, unknown>): Promise<unknown> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(config.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-meta-backfill-orchestrator-secret": config.secret,
    },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const action = typeof body.action === "string" ? body.action : "unknown";
    throw new Error(`orchestrator ${action} falhou (${res.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

export async function inspectAccount(
  config: OrchestratorConfig,
  args: { clientId: string; adAccountRef: string },
): Promise<InspectResult> {
  return (await callOrchestrator(config, { action: "inspect", ...args })) as InspectResult;
}

export interface CreateJobArgs {
  clientId: string;
  adAccountRef: string;
  requestedLevels: readonly BackfillLevel[];
  targetStartDate: string;
  targetEndDate: string;
  segments: ReadonlyArray<{ level: BackfillLevel; dateFrom: string; dateTo: string }>;
}

export async function createJob(config: OrchestratorConfig, args: CreateJobArgs): Promise<CreateJobResult> {
  return (await callOrchestrator(config, { action: "create", ...args })) as CreateJobResult;
}

export async function getJobStatus(config: OrchestratorConfig, args: { jobId: string }): Promise<StatusResult> {
  return (await callOrchestrator(config, { action: "status", ...args })) as StatusResult;
}
