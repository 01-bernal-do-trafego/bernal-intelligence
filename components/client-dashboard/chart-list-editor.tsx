"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  AVAILABLE_CHART_METRICS,
  CHART_METRIC_CATALOG,
  MAX_CHARTS,
  addChart,
  changeChartMetric,
  compatibleVisualizations,
  moveItem,
  removeChart,
  updateChart,
  visualizationLabel,
  type ChartConfig,
} from "@/lib/dashboard-config";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const METRIC_OPTIONS = CHART_METRIC_CATALOG.map((m) => ({
  value: m.key,
  label: m.requiresMeta ? `${m.label} (após integração Meta)` : m.label,
  disabled: Boolean(m.requiresMeta),
}));

interface ChartListEditorProps {
  charts: ChartConfig[];
  onChange: (next: ChartConfig[]) => void;
}

export function ChartListEditor({ charts, onChange }: ChartListEditorProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Gráficos</h3>
          <p className="text-xs text-muted">
            Cada gráfico tem uma métrica, um tipo de visualização e um título.
          </p>
        </div>
        <button
          type="button"
          disabled={charts.length >= MAX_CHARTS}
          onClick={() => onChange(addChart(charts, AVAILABLE_CHART_METRICS[0]?.key))}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-foreground transition-colors hover:border-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Adicionar gráfico
        </button>
      </div>

      {charts.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
          Nenhum gráfico. Use “Adicionar gráfico”.
        </p>
      )}

      <ul className="space-y-2">
        {charts.map((chart, index) => {
          const vizOptions = compatibleVisualizations(chart.metric).map((v) => ({
            value: v,
            label: visualizationLabel(v),
          }));
          return (
            <li
              key={chart.id}
              className="space-y-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">
                    Métrica
                  </label>
                  <Select
                    options={METRIC_OPTIONS}
                    value={chart.metric}
                    onChange={(e) =>
                      onChange(changeChartMetric(charts, chart.id, e.target.value))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">
                    Tipo de gráfico
                  </label>
                  <Select
                    options={vizOptions}
                    value={chart.visualization}
                    onChange={(e) =>
                      onChange(
                        updateChart(charts, chart.id, {
                          visualization: e.target
                            .value as ChartConfig["visualization"],
                        }),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">
                    Título
                  </label>
                  <Input
                    value={chart.title}
                    maxLength={80}
                    onChange={(e) =>
                      onChange(
                        updateChart(charts, chart.id, { title: e.target.value }),
                      )
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border accent-accent"
                    checked={chart.enabled}
                    onChange={() =>
                      onChange(
                        updateChart(charts, chart.id, { enabled: !chart.enabled }),
                      )
                    }
                  />
                  {chart.enabled ? "Ativo" : "Inativo"}
                </label>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onChange(moveItem(charts, index, -1))}
                    aria-label="Mover para cima"
                    className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={index === charts.length - 1}
                    onClick={() => onChange(moveItem(charts, index, 1))}
                    aria-label="Mover para baixo"
                    className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(removeChart(charts, chart.id))}
                    aria-label="Remover gráfico"
                    className={cn(
                      "ml-1 inline-flex items-center gap-1 rounded p-1 text-xs text-negative",
                      "transition-colors hover:bg-negative/10",
                    )}
                  >
                    <Trash2 className="size-4" />
                    Remover
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
