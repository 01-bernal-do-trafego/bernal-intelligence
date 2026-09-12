/**
 * DATA V2.3B — Earliest-Date Discovery. Algoritmo de busca (Deno, REAL).
 *
 * ESPELHO de `lib/backfill/earliest-date-discovery.ts` (Node, referência
 * testada em Vitest) — fronteira Deno não importa de `lib/` (mesma regra já
 * estabelecida para `lib/backfill/executor.ts` ⟷
 * `meta-backfill-executor/index.ts`). Mantenha os dois em sync se um mudar;
 * ver o cabeçalho do arquivo Node para a explicação completa do algoritmo
 * (bounded/logarítmico no caso feliz, fallback em blocos se a Graph rejeitar
 * o range inteiro, confirmação do dia exato, guarda de probes).
 *
 * Este arquivo é usado DIRETAMENTE por `meta-backfill-discovery/index.ts` —
 * zero cópia adicional dentro do Deno (só existe UM lugar em Deno-land que
 * decide o algoritmo).
 */

export interface ProbeRange {
  since: string;
  until: string;
}

/**
 * `"range_rejected"` é o ÚNICO valor que aciona o fallback chunked — os
 * outros 5 (mesmo vocabulário de `GraphErrorKind`, `_shared/graph.ts`)
 * NUNCA disparam fallback, viram `probe_error` direto. O adapter real
 * (`meta-backfill-discovery/index.ts`) classifica `range_rejected` a partir
 * de `GraphApiError.code === 100` ("Invalid parameter") — sem ampliar
 * `GraphErrorKind`/`classifyGraphError` compartilhados (o executor V2.2.3
 * continua só lendo `.kind`, intocado).
 */
export interface ProbeResult {
  hasData: boolean;
  errorKind?:
    | "token_revoked"
    | "insufficient_permission"
    | "rate_limited"
    | "transient"
    | "unknown"
    | "range_rejected"
    | null;
}

export type ProbeFn = (range: ProbeRange) => Promise<ProbeResult>;

export interface DiscoverEarliestDateInput {
  accountCreatedDate: string;
  latestClosedDate: string;
  probe: ProbeFn;
  maxProbes?: number;
  chunkDays?: number;
}

export const DEFAULT_MAX_DISCOVERY_PROBES = 60;
export const DEFAULT_DISCOVERY_CHUNK_DAYS = 180;

export type DiscoveryOutcome =
  | { status: "no_history"; probesPerformed: number; strategy: "full_range" | "chunked" }
  | { status: "found"; earliestDate: string; probesPerformed: number; strategy: "full_range" | "chunked" }
  | { status: "probe_limit_exceeded"; probesPerformed: number }
  | { status: "confirmation_failed"; candidateDate: string; probesPerformed: number }
  | { status: "probe_error"; errorKind: string; probesPerformed: number };

function parseISO(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function addDaysPure(date: string, n: number): string {
  return toISO(parseISO(date) + n * 86_400_000);
}
function daysBetweenPure(a: string, b: string): number {
  return Math.round((parseISO(b) - parseISO(a)) / 86_400_000);
}
function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

type ProbeStep = { kind: "data"; hasData: boolean } | { kind: "error"; errorKind: string } | { kind: "limit" };

export async function discoverEarliestDate(input: DiscoverEarliestDateInput): Promise<DiscoveryOutcome> {
  const maxProbes = input.maxProbes ?? DEFAULT_MAX_DISCOVERY_PROBES;
  const chunkDays = input.chunkDays ?? DEFAULT_DISCOVERY_CHUNK_DAYS;
  let probesPerformed = 0;

  const probe = async (since: string, until: string): Promise<ProbeStep> => {
    if (probesPerformed >= maxProbes) return { kind: "limit" };
    probesPerformed += 1;
    const r = await input.probe({ since, until });
    if (r.errorKind) return { kind: "error", errorKind: r.errorKind };
    return { kind: "data", hasData: r.hasData === true };
  };

  if (input.accountCreatedDate > input.latestClosedDate) {
    return { status: "no_history", probesPerformed: 0, strategy: "full_range" };
  }

  let searchLo = input.accountCreatedDate;
  let searchHi = input.latestClosedDate;
  let strategy: "full_range" | "chunked" = "full_range";

  const wide = await probe(input.accountCreatedDate, input.latestClosedDate);
  if (wide.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };

  if (wide.kind === "error") {
    // SÓ "range_rejected" aciona o fallback — qualquer outro erro (auth,
    // permissão, rate limit, transient, unknown) falha explicitamente aqui.
    if (wide.errorKind !== "range_rejected") {
      return { status: "probe_error", errorKind: wide.errorKind, probesPerformed };
    }
    strategy = "chunked";
    let chunkStart = input.accountCreatedDate;
    let foundChunk: { start: string; end: string } | null = null;
    while (chunkStart <= input.latestClosedDate) {
      const chunkEnd = minDate(addDaysPure(chunkStart, chunkDays - 1), input.latestClosedDate);
      const r = await probe(chunkStart, chunkEnd);
      if (r.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };
      if (r.kind === "error") return { status: "probe_error", errorKind: r.errorKind, probesPerformed };
      if (r.kind === "data" && r.hasData) {
        foundChunk = { start: chunkStart, end: chunkEnd };
        break;
      }
      chunkStart = addDaysPure(chunkEnd, 1);
    }
    if (!foundChunk) return { status: "no_history", probesPerformed, strategy };
    searchLo = foundChunk.start;
    searchHi = foundChunk.end;
  } else if (!wide.hasData) {
    return { status: "no_history", probesPerformed, strategy };
  }

  let loN = 0;
  let hiN = daysBetweenPure(searchLo, searchHi);
  while (loN < hiN) {
    const midN = Math.floor((loN + hiN) / 2);
    const midDate = addDaysPure(searchLo, midN);
    const r = await probe(searchLo, midDate);
    if (r.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };
    if (r.kind === "error") return { status: "probe_error", errorKind: r.errorKind, probesPerformed };
    if (r.kind === "data" && r.hasData) {
      hiN = midN;
    } else {
      loN = midN + 1;
    }
  }
  const candidate = addDaysPure(searchLo, loN);

  const confirm = await probe(candidate, candidate);
  if (confirm.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };
  if (confirm.kind === "error") return { status: "probe_error", errorKind: confirm.errorKind, probesPerformed };
  if (!confirm.hasData) {
    return { status: "confirmation_failed", candidateDate: candidate, probesPerformed };
  }

  return { status: "found", earliestDate: candidate, probesPerformed, strategy };
}
