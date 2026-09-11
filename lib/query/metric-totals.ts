/**
 * DATA FOUNDATION V2.1 — Query Layer. `resolveMetricTotals`. Módulo PURO.
 *
 * Total de período de N métricas para um escopo — sem saber, quem chama, se a
 * métrica é coluna/ação/fórmula, se é aditiva, se precisa do periódico exato
 * ou como a atribuição é escolhida.
 *
 * FONTE DOS TOTAIS (paridade com `server/real-dashboard.ts`):
 *   escopo de 1 ENTIDADE + linha `meta_insights_periodic` no intervalo EXATO
 *   -> os totais (aditivas E conversões) vêm INTEIRAMENTE dessa linha — ela
 *      não sofre com buraco de cobertura diária e é o que bate com o Ads
 *      Manager. `reach`/`frequency`/`video_avg_time_watched` SÓ existem aqui.
 *   senão (multi-entidade, ou sem periodic exato para a entidade)
 *   -> soma das linhas diárias do escopo no intervalo (aditivas/conversões).
 *      `reach`/`frequency`/`video_avg_time_watched` ficam indisponíveis —
 *      NUNCA reconstruídos por soma diária.
 *
 * REGRAS DE AGREGAÇÃO (ver `lib/metrics/aggregation.ts`):
 *   direct_sum                -> soma (linhas diárias OU periodic, ver acima).
 *   recompute_from_components -> MESMA fonte acima; a fórmula é reaplicada
 *                                sobre os componentes somados/periódicos
 *                                (nunca soma/média do valor da métrica em si).
 *   exact_periodic_only       -> só de `meta_insights_periodic` no intervalo
 *                                EXATO, e só quando o escopo é 1 ENTIDADE
 *                                (reach/frequency não são consolidáveis entre
 *                                contas — não existe "reach de 3 contas" sem
 *                                a Meta agregar). Sem linha exata -> `null`.
 *   none                       -> métrica sem semântica matemática (placeholder).
 *
 * FALHA SEGURA (não derruba o restante do pedido):
 *   metricId desconhecido, nível incompatível, escopo multi-entidade p/
 *   métrica exact_periodic_only, ou sem linha periódica exata -> aquele item
 *   volta com `value: null` + `DataQuality` honesta (motivo em `reasons`).
 *   NENHUM desses lança exceção.
 *
 * FALHA DURA (lança exceção — é bug de quem chama, não estado de dado):
 *   `range.from > range.to`.
 */
import { computeMetric, type MetricTotals } from "@/lib/metrics/compute";
import { getMetricDefinition, resolveMetricId } from "@/lib/metrics/registry";
import { aggregationMethod } from "@/lib/metrics/aggregation";
import { selectAuthoritativePeriodicRow } from "@/lib/meta/periodic-select";
import { conversionTotalsFromRow } from "@/lib/meta/conversion-events";
import { withResolvedResults } from "@/lib/meta/result-metric-resolve";
import { getDataQuality, type DataQualityInput } from "@/lib/data-quality";
import { unavailableQuality } from "./quality";
import {
  buildMetricTotals,
  filterPeriodicRows,
  scopedDedupedDailyRows,
} from "./rows";
import type {
  DateRange,
  MetricValueResult,
  NormalizedDailyRow,
  NormalizedPeriodicRow,
  QueryScope,
  ResultMetricContext,
} from "./types";

/** `from > to` é bug de quem chama — falha dura, não estado de dado. */
export function assertValidRange(range: DateRange): void {
  if (range.from > range.to) {
    throw new Error(
      `Query Layer: intervalo inválido (from="${range.from}" > to="${range.to}").`,
    );
  }
}

export interface ResolveMetricTotalsInput {
  scope: QueryScope;
  range: DateRange;
  metricIds: readonly string[];
  /** Linhas JÁ buscadas pelo adapter (não é a Query Layer que consulta o banco). */
  dailyRows: readonly NormalizedDailyRow[];
  periodicRows: readonly NormalizedPeriodicRow[];
  resultMetric?: ResultMetricContext["resultMetric"];
  /** Coverage/health do range — se omitido, deriva só de `hasRows` das linhas diárias. */
  dataQuality?: Partial<DataQualityInput>;
}

export function resolveMetricTotals(
  input: ResolveMetricTotalsInput,
): MetricValueResult[] {
  assertValidRange(input.range);

  const dailyScoped = scopedDedupedDailyRows(
    input.dailyRows,
    input.scope,
    input.range,
  );
  const periodicScoped = filterPeriodicRows(input.periodicRows, input.scope);

  const singleEntity =
    input.scope.entityIds.length === 1 ? input.scope.entityIds[0] : null;
  const periodicExact = singleEntity
    ? selectAuthoritativePeriodicRow(
        periodicScoped.filter((r) => r.entity_id === singleEntity),
        { from: input.range.from, to: input.range.to },
      )
    : null;

  // Fonte única dos totais: periodic EXATO quando existir (não sofre buraco de
  // cobertura diária); senão, soma das linhas diárias do escopo.
  const totals: MetricTotals = periodicExact
    ? withResolvedResults(
        {
          ...conversionTotalsFromRow(periodicExact),
          video_3s_views: periodicExact.video_3s_views,
          video_thruplays: periodicExact.video_thruplays,
        },
        input.resultMetric ?? null,
      )
    : buildMetricTotals({
        rows: dailyScoped,
        nonAdditive: null, // sem periodic exato -> reach/frequency ficam indisponíveis
        resultMetric: input.resultMetric,
      });

  const hasRows = periodicExact != null || dailyScoped.length > 0;
  const sharedQuality = getDataQuality({
    ...input.dataQuality,
    hasRows: input.dataQuality?.hasRows ?? hasRows,
  });

  return input.metricIds.map((rawId) => {
    const metricId = resolveMetricId(rawId);
    const def = getMetricDefinition(metricId);

    if (!def) {
      return { metricId, value: null, quality: unavailableQuality("unknown_metric") };
    }
    if (!def.levels.includes(input.scope.level)) {
      return {
        metricId,
        value: null,
        quality: unavailableQuality("level_not_supported"),
      };
    }

    const method = aggregationMethod(metricId);

    if (method === "none") {
      return {
        metricId,
        value: null,
        quality: unavailableQuality("no_aggregation_semantics"),
      };
    }

    if (method === "exact_periodic_only") {
      if (!singleEntity) {
        return {
          metricId,
          value: null,
          quality: unavailableQuality("not_consolidable_multi_entity"),
        };
      }
      if (!periodicExact) {
        return {
          metricId,
          value: null,
          quality: unavailableQuality("no_exact_periodic_match"),
        };
      }
      return {
        metricId,
        value: computeMetric(metricId, totals),
        quality: sharedQuality,
      };
    }

    // direct_sum | recompute_from_components -> totais já somados.
    return {
      metricId,
      value: computeMetric(metricId, totals),
      quality: sharedQuality,
    };
  });
}
