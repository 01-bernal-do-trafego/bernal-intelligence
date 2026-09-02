import type { ResultMetricConfig, ResultMetricType } from "@/types/domain";

/**
 * Presets da conversão principal. O `type` é o id estável salvo em
 * `dashboard_configs.result_metric`; `resultLabel` é o nome exibido padrão e
 * `behavior` a classificação padrão (o editor pode sobrescrever ambos).
 */
export const RESULT_METRIC_PRESETS: Record<ResultMetricType, ResultMetricConfig> =
  {
    leads: {
      type: "leads",
      resultLabel: "Leads",
      costLabel: "Custo por lead",
      behavior: "higher_is_better",
    },
    purchases: {
      type: "purchases",
      resultLabel: "Compras",
      costLabel: "Custo por compra",
      behavior: "higher_is_better",
    },
    conversations: {
      type: "conversations",
      resultLabel: "Conversas",
      costLabel: "Custo por conversa",
      behavior: "higher_is_better",
    },
    registrations: {
      type: "registrations",
      resultLabel: "Cadastros",
      costLabel: "Custo por cadastro",
      behavior: "higher_is_better",
    },
    appointments: {
      type: "appointments",
      resultLabel: "Agendamentos",
      costLabel: "Custo por agendamento",
      behavior: "higher_is_better",
    },
    results: {
      type: "results",
      resultLabel: "Resultados",
      costLabel: "Custo por resultado",
      behavior: "higher_is_better",
    },
    custom: {
      type: "custom",
      resultLabel: "Resultados",
      costLabel: "Custo por resultado",
      behavior: "higher_is_better",
    },
  };

export const DEFAULT_RESULT_METRIC = RESULT_METRIC_PRESETS.results;

export function resultMetricOf(type: ResultMetricType): ResultMetricConfig {
  return RESULT_METRIC_PRESETS[type] ?? DEFAULT_RESULT_METRIC;
}
