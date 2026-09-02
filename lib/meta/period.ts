import {
  PERIOD_PRESETS,
  isPeriodPreset,
  type DateRange,
  type PeriodPreset,
} from "@/lib/date-range";

/**
 * Chaves de período do Bernal ↔ `meta_insights_periodic.period_key`.
 *
 * ── POR QUE ESTA TABELA EXISTE ───────────────────────────────────────────
 * `meta_insights_daily` serve para GRÁFICOS temporais (um ponto por dia).
 * Métricas aditivas (spend, impressions, cliques, conversões) podem ter o
 * total do período pela soma dos dias. Mas `reach` (pessoas únicas) e
 * `frequency` (impressões / reach do período) NÃO podem: a mesma pessoa
 * alcançada em dois dias conta 1 no período, não 2. Somar reach diário
 * SUPERESTIMA o alcance e SUBESTIMA a frequência.
 *
 * Solução: o serviço de sincronização faz, além do fetch diário, UMA chamada
 * de insights SEM `time_increment` para cada período abaixo. A Meta agrega com
 * as MESMAS regras do Ads Manager (dedup de pessoas, janela de atribuição).
 * O resultado vai para `meta_insights_periodic`. Cards/totais leem de lá;
 * gráficos leem de `meta_insights_daily`.
 *
 *   presets  → linha por (level, entity, period_key, attribution_window),
 *              sobrescrita a cada sync (janela móvel sempre atual).
 *   custom   → linha por (level, entity, date_from, date_to, attr_window),
 *              cache sob demanda quando o usuário escolhe um intervalo livre.
 */

export const META_PERIOD_PRESET_KEYS = PERIOD_PRESETS.map((p) => p.value);

export const META_CUSTOM_PERIOD_KEY = "custom" as const;

export type MetaPeriodKey = PeriodPreset | typeof META_CUSTOM_PERIOD_KEY;

export const META_PERIOD_KEYS: readonly MetaPeriodKey[] = [
  ...META_PERIOD_PRESET_KEYS,
  META_CUSTOM_PERIOD_KEY,
];

export function isMetaPeriodKey(value: string | null | undefined): value is MetaPeriodKey {
  return value === META_CUSTOM_PERIOD_KEY || isPeriodPreset(value);
}

/**
 * `period_key` a gravar para um pedido de período. Presets identificados pelo
 * nome (janela móvel); qualquer intervalo livre vira `"custom"` + as datas.
 */
export function metaPeriodKeyFor(
  input: PeriodPreset | { range: DateRange },
): MetaPeriodKey {
  return typeof input === "string" ? input : META_CUSTOM_PERIOD_KEY;
}

/** Identifica a linha de `meta_insights_periodic` correspondente a um período. */
export interface MetaPeriodLocator {
  periodKey: MetaPeriodKey;
  dateFrom: string;
  dateTo: string;
}

export function metaPeriodLocator(
  periodKey: MetaPeriodKey,
  range: DateRange,
): MetaPeriodLocator {
  return { periodKey, dateFrom: range.start, dateTo: range.end };
}
