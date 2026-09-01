import type { ResultMetricConfig, ResultMetricType } from "@/types/domain";

/**
 * Presets de rótulo para a conversão principal de cada cliente. A métrica
 * numérica ("results") é a mesma em todo o sistema; o que muda por cliente
 * é o significado e o rótulo exibido.
 */
export const RESULT_METRIC_PRESETS: Record<ResultMetricType, ResultMetricConfig> =
  {
    lead: { type: "lead", resultLabel: "Leads", costLabel: "Custo por lead" },
    purchase: {
      type: "purchase",
      resultLabel: "Compras",
      costLabel: "Custo por compra",
    },
    conversation: {
      type: "conversation",
      resultLabel: "Conversas",
      costLabel: "Custo por conversa",
    },
    signup: {
      type: "signup",
      resultLabel: "Cadastros",
      costLabel: "Custo por cadastro",
    },
    scheduling: {
      type: "scheduling",
      resultLabel: "Agendamentos",
      costLabel: "Custo por agendamento",
    },
    custom: {
      type: "custom",
      resultLabel: "Resultados",
      costLabel: "Custo por resultado",
    },
  };

export const DEFAULT_RESULT_METRIC = RESULT_METRIC_PRESETS.custom;

export function resultMetricOf(type: ResultMetricType): ResultMetricConfig {
  return RESULT_METRIC_PRESETS[type] ?? DEFAULT_RESULT_METRIC;
}
