/**
 * DATA V2.3B — teto defensivo de segmentos PLANEJADOS antes de criar um job
 * de verdade (full history pode gerar muitos segmentos). Módulo PURO.
 *
 * JUSTIFICATIVA (a partir dos block sizes reais de `lib/backfill/block-size.ts`):
 * pior caso plausível — conta GRANDE (>50 entidades/nível -> usa o bloco
 * MÍNIMO de cada faixa) com ~20 anos de histórico (7300 dias), todos os 4
 * levels:
 *
 *   account  (min 60d):  7300 / 60  ≈ 122 segmentos
 *   campaign (min 14d):  7300 / 14  ≈ 521 segmentos
 *   adset    (min 14d):  7300 / 14  ≈ 521 segmentos
 *   ad       (min  7d):  7300 /  7  ≈ 1043 segmentos
 *   -----------------------------------------------
 *   total ≈ 2207 segmentos
 *
 * `MAX_PLANNED_SEGMENTS = 2000` fica DELIBERADAMENTE um pouco ABAIXO desse
 * teto extremo — não é "nunca deveria passar disso tecnicamente", é "acima
 * disso, preferimos que um humano confirme deliberadamente" (ex.: rodar por
 * level separadamente) em vez do runner prosseguir sozinho para um job de
 * milhares de invocations do executor. Não é um limite pequeno arbitrário —
 * cobre qualquer full-history real plausível folgadamente (contas com menos
 * de ~15-18 anos de histórico, a esmagadora maioria, nunca chegam perto).
 */
export const MAX_PLANNED_SEGMENTS = 2000;

/** `true` quando o plano deve ser recusado (ABORT antes de `create`). */
export function exceedsMaxPlannedSegments(segmentCount: number, max: number = MAX_PLANNED_SEGMENTS): boolean {
  return segmentCount > max;
}
