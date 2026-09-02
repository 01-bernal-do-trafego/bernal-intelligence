import { describe, expect, it } from "vitest";
import { compareMetric } from "@/lib/comparison";
import {
  DEFAULT_RESULT_METRIC,
  RESULT_METRIC_PRESETS,
  resultMetricOf,
} from "@/lib/result-metric";
import type { ResultMetricType } from "@/types/domain";

const ALL_TYPES: ResultMetricType[] = [
  "leads",
  "purchases",
  "conversations",
  "messaging_conversations_started",
  "messaging_contacts_total",
  "messaging_contacts_new",
  "registrations",
  "appointments",
  "results",
  "custom",
];

describe("RESULT_METRIC_PRESETS", () => {
  it("define rótulos e comportamento para todos os tipos de resultado", () => {
    for (const type of ALL_TYPES) {
      const preset = RESULT_METRIC_PRESETS[type];
      expect(preset.type).toBe(type);
      expect(preset.resultLabel.length).toBeGreaterThan(0);
      expect(preset.costLabel.toLowerCase()).toContain("custo");
      expect(preset.behavior).toBeDefined();
    }
  });

  it("resultMetricOf cai no padrão para tipo desconhecido", () => {
    expect(resultMetricOf("nope" as ResultMetricType)).toBe(DEFAULT_RESULT_METRIC);
  });
});

describe("classificação da variação independe do tipo de resultado", () => {
  it("mais resultados é sempre positivo, qualquer que seja a conversão", () => {
    // A conversão principal muda o rótulo, nunca a regra de classificação.
    expect(compareMetric(120, 100, "higher_is_better").sentiment).toBe("positive");
    expect(compareMetric(80, 100, "higher_is_better").sentiment).toBe("negative");
  });

  it("custo por resultado menor é sempre positivo", () => {
    const c = compareMetric(14.68, 18, "lower_is_better");
    expect(c.sentiment).toBe("positive");
    expect(c.direction).toBe("down");
    expect(c.changePct).toBeCloseTo(-18.44, 1);
  });
});
