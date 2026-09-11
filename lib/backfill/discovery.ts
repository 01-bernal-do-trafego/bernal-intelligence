/**
 * DATA V2.2.2 — Historical Backfill. Discovery FOUNDATION. Módulo PURO.
 *
 * Só o CONTRATO/estrutura de decisão — NÃO chama a Meta aqui (isso é
 * executor, fase futura). Formaliza como resolver `resolvedEarliestDate` a
 * partir de fatos JÁ CONHECIDOS, separando claramente "descoberta" de
 * "planejamento de segmentos" (`planner.ts`, que só consome o resultado).
 *
 * Nunca inventa um piso arbitrário (nada de "37 meses" fixo) — sem base
 * conhecida, o resultado é `unresolved`: o job PRECISA de descoberta ativa
 * (uma chamada real à Meta, fora desta camada) antes de poder ser planejado.
 */

export interface DiscoveryInput {
  /** `account.created_time` da Meta, se já observado (ISO date). */
  accountCreatedTime: string | null;
  /** Menor `campaign.created_time` já observado entre as campanhas conhecidas. */
  earliestKnownCampaignCreatedTime: string | null;
  /** Quantos blocos consecutivos (do mais antigo pro mais recente) vieram vazios. */
  consecutiveEmptyBlocks: number;
  /** A partir de quantos blocos vazios seguidos declaramos `exhausted`. */
  emptyBlockThreshold: number;
}

export type DiscoveryOutcome =
  | { kind: "resolved"; earliestDate: string; source: "campaign" | "account" }
  | { kind: "exhausted"; earliestDate: string; source: "campaign" | "account" }
  | { kind: "unresolved" };

/**
 * Resolve a MELHOR estimativa de `resolvedEarliestDate` a partir de fatos já
 * conhecidos. Prioridade: campanha mais antiga conhecida > `account.created_time`
 * > nenhum piso (`unresolved`).
 *
 * `exhausted` = a Meta já devolveu vazio por `emptyBlockThreshold` blocos
 * seguidos perto do início conhecido — o histórico real acaba ali, mesmo que
 * um `targetStartDate` pedido fosse mais antigo. Precisa de uma base conhecida
 * para reportar `earliestDate`; sem nenhuma, mesmo exaurido fica `unresolved`
 * (não há data nenhuma para ancorar).
 */
export function resolveEarliestDate(input: DiscoveryInput): DiscoveryOutcome {
  const base: { date: string; source: "campaign" | "account" } | null =
    input.earliestKnownCampaignCreatedTime
      ? { date: input.earliestKnownCampaignCreatedTime, source: "campaign" }
      : input.accountCreatedTime
        ? { date: input.accountCreatedTime, source: "account" }
        : null;

  if (input.consecutiveEmptyBlocks >= input.emptyBlockThreshold && base) {
    return { kind: "exhausted", earliestDate: base.date, source: base.source };
  }
  if (base) {
    return { kind: "resolved", earliestDate: base.date, source: base.source };
  }
  return { kind: "unresolved" };
}
