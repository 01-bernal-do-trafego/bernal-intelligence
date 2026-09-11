/**
 * DATA FOUNDATION V2 — Aggregation Safety. Módulo PURO.
 *
 * Impede que qualquer consumidor futuro (query layer, dashboard builder,
 * Intelligence) agregue uma métrica de forma matematicamente errada.
 *
 * DUAS FORMAS DE AGREGAÇÃO — nunca confundir:
 *
 *   A) SOMA DIRETA  (`direct_sum`)
 *      `SUM(valores)` das linhas dá o total correto — no tempo E entre
 *      entidades. Só para métricas `additive` (spend, impressions, clicks,
 *      conversões contáveis, revenue, results).
 *
 *   B) RECÁLCULO A PARTIR DOS COMPONENTES  (`recompute_from_components`)
 *      NÃO se soma o valor da métrica; somam-se os COMPONENTES BRUTOS e
 *      reaplica-se a fórmula. Ex.: CTR do período = `SUM(clicks) / SUM(impressions)`;
 *      CPA = `SUM(spend) / SUM(purchases)`; CPM = `SUM(spend)/SUM(impressions)*1000`.
 *      Válido só quando TODOS os componentes são eles próprios `direct_sum`.
 *
 *   C) SÓ DO AGREGADO PERIÓDICO EXATO  (`exact_periodic_only`)
 *      Não pode ser somada nem reconstruída de linhas diárias — só vem de
 *      `meta_insights_periodic` no intervalo EXATO (regras do Ads Manager).
 *      Ex.: `reach` (pessoas únicas), `frequency` (depende do reach do período),
 *      `video_avg_time_watched` (média sem denominador de peso armazenado hoje).
 *
 *   D) SEM SEMÂNTICA MATEMÁTICA  (`none`)
 *      A métrica não participa de agregação numérica (placeholder de arquitetura
 *      ainda sem implementação real). Nenhum consumidor deve agregá-la.
 *
 * A fonte da verdade é `MetricDefinition.aggregationClass`. A derivação abaixo é
 * só um FALLBACK conservador e nunca devolve `additive`/`weighted_avg` por acaso.
 *
 * NÃO altera nenhum cálculo atual do dashboard: nada em produção importa este
 * módulo; ele existe para os blocos seguintes da Data Foundation.
 */

import {
  getMetricDefinition,
  getMetricDependencies,
  type AggregationClass,
  type ChartRole,
} from "./registry";

export { getMetricDependencies };

/** Como o total de um período/recorte deve ser obtido para esta métrica. */
export type AggregationMethod =
  | "direct_sum"
  | "recompute_from_components"
  | "exact_periodic_only"
  | "none";

/**
 * Classe de agregação declarada; se ausente, deriva dos campos V1 de forma
 * conservadora. `null` = métrica sem semântica matemática definida (placeholder).
 * Nunca devolve `additive` nem `weighted_avg` por derivação.
 */
export function getMetricAggregationClass(
  id: string,
): AggregationClass | null {
  const def = getMetricDefinition(id);
  if (!def) return null;
  if (def.aggregationClass) return def.aggregationClass;

  // ---- fallback conservador (só para uma definição sem classe) --------------
  if (def.source.kind === "formula" && def.source.formula.op === "ratio") {
    return "ratio";
  }
  switch (def.aggregation) {
    case "sum":
      return "additive";
    case "ratio":
      return "ratio";
    case "weighted_avg":
      // sem confirmação de denominador de peso -> trata como não reconstruível
      return "unique_non_additive";
    case "last":
      return def.periodSource === "periodic_only"
        ? "unique_non_additive"
        : null; // "last" fora de periodic_only só ocorre no placeholder bernal
    default:
      return "unique_non_additive";
  }
}

/**
 * Forma correta de obter o total desta métrica para um recorte.
 * É a API EXPLÍCITA — prefira-a aos booleanos abaixo quando o consumidor
 * precisa saber "o que fazer".
 */
export function aggregationMethod(id: string): AggregationMethod {
  const def = getMetricDefinition(id);
  if (!def) return "none";
  const cls = getMetricAggregationClass(id);

  if (cls === null) return "none";
  if (cls === "additive") return "direct_sum";
  if (cls === "unique_non_additive") return "exact_periodic_only";
  if (cls === "snapshot") return "exact_periodic_only"; // ponto no tempo — não somar
  if (cls === "weighted_avg") {
    // reconstruível SÓ com um denominador de peso ARMAZENADO. Nenhuma métrica
    // atende hoje (não guardamos `video_plays`) -> conservador.
    return "exact_periodic_only";
  }

  // cls === "ratio": só reconstrói se TODOS os componentes forem soma direta.
  const deps = getMetricDependencies(id);
  if (deps.length === 0) return "exact_periodic_only";
  const allComponentsDirectlySummable = deps.every(
    (d) => getMetricAggregationClass(d) === "additive",
  );
  return allComponentsDirectlySummable
    ? "recompute_from_components"
    : "exact_periodic_only";
}

/** `true` só para `additive`. Id inexistente → `false`. */
export function isAdditiveMetric(id: string): boolean {
  return getMetricAggregationClass(id) === "additive";
}

/**
 * (A) `true` quando `SUM(valores diários)` dá o total correto do período.
 * Só métricas `additive`. Ratios são `false` aqui — o correto é RECÁLCULO,
 * ver `canRecomputeFromComponents`, NUNCA média das taxas diárias.
 */
export function canSumAcrossTime(id: string): boolean {
  return aggregationMethod(id) === "direct_sum";
}

/**
 * (A) `true` quando somar o valor da métrica ENTRE entidades (contas,
 * campanhas) dá um total correto. Só `additive`.
 * `snapshot` (saldo etc., fase futura) é `false` por padrão — somar carteiras
 * é decisão explícita da UI, não capacidade default da métrica.
 */
export function canSumAcrossEntities(id: string): boolean {
  return aggregationMethod(id) === "direct_sum";
}

/**
 * (B) `true` quando o total do período deve vir de: agregar os COMPONENTES
 * brutos e reaplicar a fórmula (ex.: CTR = ΣClicks/ΣImpr). Válido só quando
 * todos os componentes são soma direta.
 * `frequency` é `false` aqui: um dos componentes (`reach`) não é somável.
 */
export function canRecomputeFromComponents(id: string): boolean {
  return aggregationMethod(id) === "recompute_from_components";
}

/**
 * (C) `true` quando o total de período SÓ é confiável vindo de
 * `meta_insights_periodic` no intervalo EXATO — nem soma, nem recálculo de
 * componentes. Ex.: `reach`, `frequency`, `video_avg_time_watched`.
 */
export function requiresExactPeriodicAggregate(id: string): boolean {
  return aggregationMethod(id) === "exact_periodic_only";
}

/** `true` se a métrica declara o papel `role`. Id/role inexistente → `false`. */
export function canUseMetricInChartRole(id: string, role: ChartRole): boolean {
  return getMetricDefinition(id)?.chartRoles.includes(role) ?? false;
}

/**
 * `true` se a métrica pode ser ETAPA de um funil. Só volume/evento
 * (`funnelEligible`); nunca ratio, reach, frequency, spend ou saldo.
 */
export function canUseMetricInFunnel(id: string): boolean {
  return getMetricDefinition(id)?.funnelEligible === true;
}

/**
 * Métrica cujo VOLUME indica se há amostra suficiente para uma conclusão
 * (ex.: CPA → `purchases`). `null` se a métrica não declara — nenhum produtor
 * de "insufficient_sample" nesta fase.
 */
export function getSignificanceMetric(id: string): string | null {
  return getMetricDefinition(id)?.significanceMetric ?? null;
}

/** Correlatos fortes declarados (para `supportingSignals` do Intelligence). */
export function getRelatedMetrics(id: string): string[] {
  return [...(getMetricDefinition(id)?.relatedMetrics ?? [])];
}
