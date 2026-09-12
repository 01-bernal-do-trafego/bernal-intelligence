/**
 * DATA V2.3B — Earliest-Date Discovery. Algoritmo de busca. Módulo PURO.
 *
 * Referência canônica testada em Vitest. A Edge Function real
 * (`supabase/functions/meta-backfill-discovery/`, Deno) tem uma cópia
 * ESPELHADA em `_shared/discovery-algorithm.ts` — fronteira Deno não importa
 * de `lib/` (mesma regra já estabelecida para `lib/backfill/executor.ts` ⟷
 * `meta-backfill-executor/index.ts`). Mantenha os dois em sync se um mudar;
 * a Deno tem sua própria suíte `deno test` (menor, confirmatória).
 *
 * OBJETIVO: encontrar a MENOR data com dado real disponível na Meta Insights
 * API, entre `accountCreatedDate` (limite inferior) e `latestClosedDate`
 * (limite superior — o último dia TOTALMENTE fechado no timezone da conta,
 * resolvido FORA deste módulo). Nunca inventa uma data — se não houver dado
 * algum no intervalo, devolve `no_history`.
 *
 * COMPLEXIDADE: aproximadamente logarítmica no caso feliz (a Graph aceita o
 * range inteiro em 1 request): 1 probe do range inteiro + ~log2(dias) probes
 * de binary search + 1 probe de confirmação. NUNCA faz 1 request por dia.
 *
 * FALLBACK (range rejeitado pela API): varre em BLOCOS amplos
 * (`chunkDays`, default ~180 dias) do mais antigo para o mais novo até achar
 * o primeiro bloco com dado — só então faz o binary search, agora limitado
 * a esse bloco. Um erro de probe (não "sem dado") NUNCA é mascarado como
 * `no_history` — vira `probe_error`, com o motivo.
 *
 * MICRO-AUDITORIA (pré-checkpoint): o fallback chunked só é acionado quando
 * o erro do probe do RANGE INTEIRO é especificamente `errorKind:
 * "range_rejected"` (o adapter real classifica isso a partir do `error.code`
 * cru da Meta — código 100, "Invalid parameter" — via `GraphApiError.code`,
 * sem ampliar `GraphErrorKind`/`classifyGraphError` compartilhados, que o
 * executor V2.2.3 também usa). QUALQUER outro erro (`token_revoked`,
 * `insufficient_permission`, `rate_limited`, `transient`, `unknown`) NUNCA
 * dispara o fallback — vira `probe_error` imediatamente, com o `errorKind`
 * original preservado. Isto evita, por exemplo, que um erro de auth ou uma
 * pressão de rate limit sejam silenciosamente reinterpretados como "range
 * grande demais" e gerem uma varredura de blocos desnecessária (e, no caso
 * de rate limit, ainda mais chamadas exatamente quando deveríamos parar).
 *
 * GUARDA DEFENSIVA: `maxProbes` (default `DEFAULT_MAX_DISCOVERY_PROBES`)
 * nunca é excedido — ao atingir o limite, devolve `probe_limit_exceeded`
 * em vez de continuar (nunca loop infinito, nunca "só mais uma tentativa").
 */

export interface ProbeRange {
  since: string;
  until: string;
}

/**
 * Resultado de 1 probe real (Meta). `errorKind` presente = a chamada falhou
 * (não é "sem dado"). `"range_rejected"` é o ÚNICO valor que aciona o
 * fallback chunked — os outros 5 (mesmo vocabulário de `GraphErrorKind`)
 * NUNCA disparam fallback, viram `probe_error` direto.
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
  /** Limite inferior — data de criação da conta (YYYY-MM-DD), já na tz certa (string crua da Meta, sem reprocessar). */
  accountCreatedDate: string;
  /** Limite superior — último dia FECHADO no timezone da conta (YYYY-MM-DD). */
  latestClosedDate: string;
  probe: ProbeFn;
  maxProbes?: number;
  chunkDays?: number;
}

/** 1 (range inteiro) + ~30 blocos (conta de ~15 anos / 180 dias, pior caso do fallback) + ~8 binary search + 1 confirmação ≈ 40 — folga até 60. Documentado, não arbitrário. */
export const DEFAULT_MAX_DISCOVERY_PROBES = 60;
/** ~6 meses — amplo o bastante para não virar scan diário, pequeno o bastante para não estourar limites de range da API. */
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

/**
 * Roda o algoritmo completo. Ver cabeçalho do arquivo para o fluxo. NUNCA
 * lança — todo desfecho (inclusive erro/limite) é um `DiscoveryOutcome`.
 */
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

  // range inválido (ex.: conta criada hoje, ainda sem nenhum dia fechado) -> sem probe algum.
  if (input.accountCreatedDate > input.latestClosedDate) {
    return { status: "no_history", probesPerformed: 0, strategy: "full_range" };
  }

  let searchLo = input.accountCreatedDate;
  let searchHi = input.latestClosedDate;
  let strategy: "full_range" | "chunked" = "full_range";

  // 1. tenta o range inteiro como 1 request só.
  const wide = await probe(input.accountCreatedDate, input.latestClosedDate);
  if (wide.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };

  if (wide.kind === "error") {
    // SÓ "range_rejected" aciona o fallback — qualquer outro erro (auth,
    // permissão, rate limit, transient, unknown) falha explicitamente aqui,
    // sem tentar blocos (nunca mascara o motivo real do erro).
    if (wide.errorKind !== "range_rejected") {
      return { status: "probe_error", errorKind: wide.errorKind, probesPerformed };
    }
    // 2. fallback: bloco a bloco, do mais antigo para o mais novo, até achar o 1º com dado.
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

  // 3. binary search dentro de [searchLo, searchHi] (hasData([searchLo,searchHi]) já é true) pela menor data com dado.
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

  // 4. confirmação: probe do dia EXATO (defensivo — nunca aceita o candidato sem checar).
  const confirm = await probe(candidate, candidate);
  if (confirm.kind === "limit") return { status: "probe_limit_exceeded", probesPerformed };
  if (confirm.kind === "error") return { status: "probe_error", errorKind: confirm.errorKind, probesPerformed };
  if (!confirm.hasData) {
    return { status: "confirmation_failed", candidateDate: candidate, probesPerformed };
  }

  return { status: "found", earliestDate: candidate, probesPerformed, strategy };
}
