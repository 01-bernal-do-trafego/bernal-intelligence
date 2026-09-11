/**
 * DATA V2.2.2 — Historical Backfill. Planner de segmentos. Módulo PURO.
 *
 * Transforma a INTENÇÃO de um job (níveis, intervalo alvo) em uma lista de
 * `SegmentPlan` — SEM inserir nada no banco (isso é responsabilidade de quem
 * chama, numa fase futura com um adapter real; aqui é só o cálculo).
 *
 * ORDEM — duas decisões deliberadas:
 *   1. Dentro de CADA nível: mais recente -> mais antigo (`targetEndDate` para
 *      trás). Histórico recente tem mais valor operacional e amplia rápido os
 *      ranges disponíveis nos presets atuais.
 *   2. Entre NÍVEIS: `account -> campaign -> adset -> ad` (nunca intercalado
 *      por data). Do mais barato/agregado para o mais granular/caro — cobre
 *      rápido o nível mais barato (1 linha/dia) antes de gerar o volume maior
 *      do nível `ad`. Evita misturar prioridades dentro do mesmo job.
 *
 * SEM OVERLAP, SEM GAP: o próximo bloco sempre começa exatamente 1 dia antes
 * do início do bloco anterior — por construção, não por checagem posterior.
 *
 * "todo o período disponível" (targetStartDate = null) NUNCA vira uma data
 * inventada: sem `resolvedEarliestDate` (fato de uma discovery futura,
 * `lib/backfill/discovery.ts`), o planner devolve `requiresDiscovery: true` e
 * NENHUM segmento — nunca um piso arbitrário tipo "37 meses".
 */
import type { EntityCountHints, BlockSizeRange } from "./block-size";
import { resolveBlockSizeDays } from "./block-size";
import type { BackfillLevel } from "./types";

const LEVEL_ORDER: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];

export interface BackfillJobPlanInput {
  jobId: string;
  requestedLevels: readonly BackfillLevel[];
  /** Alvo explícito (YYYY-MM-DD), ou `null` = "todo o período disponível". */
  targetStartDate: string | null;
  /** Normalmente 1 dia antes do horizonte operacional (dailyHorizon). */
  targetEndDate: string;
  /** Já descoberto (ver discovery.ts) — só usado quando targetStartDate é null. */
  resolvedEarliestDate: string | null;
  entityHints?: EntityCountHints;
  blockSizeConfig?: Readonly<Record<BackfillLevel, BlockSizeRange>>;
}

export interface SegmentPlan {
  level: BackfillLevel;
  dateFrom: string;
  dateTo: string;
  /** Ordem de execução pretendida — 0 = primeiro. */
  order: number;
}

export interface PlanResult {
  segments: readonly SegmentPlan[];
  /** `true` = não há data de início conhecida (nem alvo, nem descoberta) — nenhum segmento foi gerado. */
  requiresDiscovery: boolean;
}

function parseISO(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  return toISO(parseISO(date) + n * 86_400_000);
}

/**
 * Planeja os segmentos de um job. Puro/síncrono — não toca banco nem Meta.
 * Lança se `earliest > targetEndDate` (intervalo invertido — bug de quem
 * chama, não estado de dado, mesma convenção da Query Layer V2.1).
 */
export function planBackfillSegments(input: BackfillJobPlanInput): PlanResult {
  const earliest = input.targetStartDate ?? input.resolvedEarliestDate;
  if (earliest === null) {
    return { segments: [], requiresDiscovery: true };
  }
  if (earliest > input.targetEndDate) {
    throw new Error(
      `planBackfillSegments: earliest (${earliest}) é depois de targetEndDate (${input.targetEndDate})`,
    );
  }

  const levels = LEVEL_ORDER.filter((l) => input.requestedLevels.includes(l));
  const segments: SegmentPlan[] = [];
  let order = 0;

  for (const level of levels) {
    const blockDays = resolveBlockSizeDays(level, input.entityHints, input.blockSizeConfig);
    let cursorEnd = input.targetEndDate;
    // guarda de segurança — nunca deveria disparar (o loop sempre reduz o
    // intervalo), mas evita loop infinito em caso de bug futuro na aritmética.
    let guard = 0;
    while (cursorEnd >= earliest) {
      guard += 1;
      if (guard > 100_000) {
        throw new Error(`planBackfillSegments: guard de segurança excedido (nível ${level})`);
      }
      const naiveStart = addDays(cursorEnd, -(blockDays - 1));
      const cursorStart = naiveStart < earliest ? earliest : naiveStart;
      segments.push({ level, dateFrom: cursorStart, dateTo: cursorEnd, order: order++ });
      if (cursorStart <= earliest) break;
      cursorEnd = addDays(cursorStart, -1);
    }
  }

  return { segments, requiresDiscovery: false };
}
