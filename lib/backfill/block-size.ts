/**
 * DATA V2.2.2 — Historical Backfill. Tamanho dos blocos de segmento. Módulo PURO.
 *
 * Configuração CENTRAL, não hardcoded espalhada — nem "verdade universal".
 * Base conceitual (auditoria original da Data Foundation V2 + DATA V2.2A):
 *   account  até 90 dias · campaign até 30 dias · adset 14–30 dias · ad 7–14 dias
 *
 * A escolha dentro da faixa é uma estratégia ADAPTATIVA SIMPLES (regra fixa
 * por contagem de entidades, não medição real de payload/timeout ainda —
 * isso exige dados de execução real, que só existem depois do primeiro
 * backfill de verdade, DATA V2.2.3+): contas GRANDES usam o menor bloco da
 * faixa (mais chamadas, cada uma mais leve, menos risco de paginação/timeout);
 * contas pequenas usam o maior bloco (menos chamadas).
 *
 * Cenário real conhecido (DATA V2.2A): Atacado do Chinelo (95 ads) é hoje a
 * maior conta — candidata natural ao primeiro teste de carga; Oversized
 * Store (9 ads) fica bem abaixo do limiar "grande".
 */
import type { BackfillLevel } from "./types";

export interface BlockSizeRange {
  /** menor bloco da faixa — usado para contas/níveis GRANDES. */
  min: number;
  /** maior bloco da faixa — usado para contas/níveis pequenos. */
  max: number;
  /** usado quando não há hint de tamanho (ex.: nível `account`, sempre 1 linha/dia). */
  default: number;
}

export const BLOCK_SIZE_DAYS: Readonly<Record<BackfillLevel, BlockSizeRange>> = {
  account: { min: 60, max: 90, default: 90 },
  campaign: { min: 14, max: 30, default: 30 },
  adset: { min: 14, max: 30, default: 21 },
  ad: { min: 7, max: 14, default: 10 },
};

/** Contagem de entidades conhecida da conta — usada só para a heurística de tamanho. */
export interface EntityCountHints {
  campaigns?: number;
  adsets?: number;
  ads?: number;
}

/** Acima disso, o nível é tratado como "grande" (usa o bloco mínimo da faixa). */
export const LARGE_ENTITY_COUNT_THRESHOLD = 50;

function hintFor(level: BackfillLevel, hints: EntityCountHints | undefined): number | undefined {
  if (!hints) return undefined;
  if (level === "campaign") return hints.campaigns;
  if (level === "adset") return hints.adsets;
  if (level === "ad") return hints.ads;
  return undefined; // account: sempre 1 linha/dia, sem heurística de tamanho
}

/**
 * Dias por bloco para `level`, dado um hint opcional de tamanho da conta.
 * Sem hint (ou nível `account`) -> `default` da faixa. Com hint acima do
 * limiar -> `min` (mais seguro para contas grandes); abaixo -> `max`.
 */
export function resolveBlockSizeDays(
  level: BackfillLevel,
  hints?: EntityCountHints,
  config: Readonly<Record<BackfillLevel, BlockSizeRange>> = BLOCK_SIZE_DAYS,
): number {
  const range = config[level];
  const count = hintFor(level, hints);
  if (count === undefined) return range.default;
  return count > LARGE_ENTITY_COUNT_THRESHOLD ? range.min : range.max;
}
