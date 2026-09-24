import {
  DEFAULT_PERIOD,
  PERIOD_PRESETS,
  isPeriodPreset,
  parseCustomRange,
  parsePeriod,
  type DateRange,
  type PeriodPreset,
} from "@/lib/date-range";
import { metaPresetRange } from "./date-preset";

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
 * ── IDENTIDADE DO AGREGADO (revisão META 5) ──────────────────────────────
 * A unicidade de uma linha de `meta_insights_periodic` é o INTERVALO:
 *   (level, entity_id, date_from, date_to, attribution_window)
 * `period_key` (`last_30d`, `last_7d`, `this_month`, `custom`, ...) é só um
 * RÓTULO — não define unicidade. Assim `last_30d` calculado em datas
 * diferentes gera linhas distintas que CONVIVEM (o período anterior continua
 * disponível), e `reach`/`frequency` ficam associados ao intervalo correto.
 * Ver `lib/meta/periodic-identity.ts`.
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

/**
 * Período resolvido a partir dos parâmetros da URL: um preset nomeado, ou
 * `custom` + o range já validado (nunca `null` quando `preset === "custom"`).
 */
export interface PeriodParamResolution {
  preset: MetaPeriodKey;
  customRange: DateRange | null;
}

/**
 * Resolve `period`/`dateFrom`/`dateTo` da URL (strings NÃO confiáveis do
 * browser) para um `MetaPeriodKey` + range custom validado.
 *
 * ÚNICO parser/resolver de período da URL — usado por `app/(app)/clients/[id]`
 * (admin) E `app/share/[token]` (share), para nunca duplicar a regra.
 *
 * `period=custom` sem `dateFrom`/`dateTo` válidos (ausente, formato errado,
 * ou `dateFrom > dateTo`) cai em `fallback` (preset) — nunca lança, nunca
 * deixa `preset === "custom"` com `customRange: null`.
 */
export function resolvePeriodParam(
  periodRaw: string | null | undefined,
  dateFromRaw: string | null | undefined,
  dateToRaw: string | null | undefined,
  fallback: PeriodPreset = DEFAULT_PERIOD,
): PeriodParamResolution {
  if (periodRaw === META_CUSTOM_PERIOD_KEY) {
    const range = parseCustomRange(dateFromRaw, dateToRaw);
    if (range) return { preset: META_CUSTOM_PERIOD_KEY, customRange: range };
    return { preset: fallback, customRange: null };
  }
  return { preset: parsePeriod(periodRaw, fallback), customRange: null };
}

/**
 * `MetaPeriodKey` + range já validado (saída de `resolvePeriodParam`) ->
 * `DateRange` concreto para consultar `meta_insights_daily`/`meta_insights_periodic`.
 * Módulo PURO — sem acesso a banco.
 *
 * `custom`: usa `customRange` diretamente (datas explícitas, sem
 * `metaPresetRange`/`today`). Sem `customRange` (chamador não validou — nunca
 * confiamos cegamente): cai no preset padrão, como um `period` desconhecido.
 *
 * PARIDADE: para qualquer preset nomeado, `resolveDashboardRange(preset, today, null)`
 * é EXATAMENTE `metaPresetRange(preset, today)` — e um `customRange` com as
 * MESMAS datas de um preset produz o MESMO `DateRange` (mesma identidade de
 * objeto de valor, comparável com `toEqual`). A Query Layer downstream
 * (`server/real-dashboard.ts`) não faz nenhuma distinção depois deste ponto —
 * dois ranges iguais produzem os mesmos totais/séries.
 */
export function resolveDashboardRange(
  preset: MetaPeriodKey,
  today: string,
  customRange: DateRange | null | undefined,
): DateRange {
  if (preset === META_CUSTOM_PERIOD_KEY) {
    return customRange ?? metaPresetRange(DEFAULT_PERIOD, today);
  }
  return metaPresetRange(preset, today);
}
