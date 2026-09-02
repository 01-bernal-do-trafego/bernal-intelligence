"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { saveDashboardConfig } from "@/app/(app)/clients/actions";
import { cn } from "@/lib/cn";
import { RESULT_METRIC_PRESETS } from "@/lib/result-metric";
import {
  CARD_CATALOG,
  CHART_CATALOG,
  METRIC_BEHAVIORS,
  METRIC_BEHAVIOR_LABEL,
  REQUIRED_TABLE_COLUMN,
  RESULT_METRIC_TYPES,
  RESULT_METRIC_TYPE_LABEL,
  TABLE_COLUMN_CATALOG,
  catalogLabel,
  moveItem,
  toggleItem,
  type CatalogEntry,
  type DashboardConfigValue,
  type LayoutItem,
} from "@/lib/dashboard-config";
import type { ResultMetricType } from "@/types/domain";
import type { MetricBehavior } from "@/lib/comparison";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface DashboardEditorProps {
  clientId: string;
  /** Config inicial. O componente é montado só quando o editor abre, então
   *  `useState(initialConfig)` já parte sempre do valor atual. */
  initialConfig: DashboardConfigValue;
  onClose: () => void;
  onSaved?: () => void;
}

function ReorderableList({
  title,
  hint,
  items,
  catalog,
  onChange,
  requiredKey,
}: {
  title: string;
  hint?: string;
  items: LayoutItem[];
  catalog: readonly CatalogEntry[];
  onChange: (next: LayoutItem[]) => void;
  requiredKey?: string;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {items.map((item, index) => {
          const entry = catalog.find((c) => c.key === item.key);
          const locked = item.key === requiredKey;
          const future = Boolean(entry?.requiresMeta);
          return (
            <li
              key={item.key}
              className="flex items-center gap-3 bg-surface px-3 py-2"
            >
              <input
                type="checkbox"
                className="size-4 rounded border-border accent-accent disabled:opacity-40"
                checked={item.enabled}
                disabled={locked || future}
                onChange={() => onChange(toggleItem(items, item.key))}
                aria-label={`Exibir ${catalogLabel(catalog, item.key)}`}
              />
              <span
                className={cn(
                  "flex-1 text-sm",
                  item.enabled ? "text-foreground" : "text-muted",
                )}
              >
                {catalogLabel(catalog, item.key)}
              </span>
              {locked && (
                <Badge tone="muted">Obrigatória</Badge>
              )}
              {future && <Badge tone="muted">Meta</Badge>}
              <div className="flex items-center">
                <button
                  type="button"
                  className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(items, index, -1))}
                  aria-label="Mover para cima"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
                  disabled={index === items.length - 1}
                  onClick={() => onChange(moveItem(items, index, 1))}
                  aria-label="Mover para baixo"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DashboardEditor({
  clientId,
  initialConfig,
  onClose,
  onSaved,
}: DashboardEditorProps) {
  const router = useRouter();
  const [config, setConfig] = useState<DashboardConfigValue>(initialConfig);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { resultMetric, layout } = config;

  function setResultMetric(patch: Partial<typeof resultMetric>) {
    setConfig((c) => ({ ...c, resultMetric: { ...c.resultMetric, ...patch } }));
  }

  function onTypeChange(type: ResultMetricType) {
    const preset = RESULT_METRIC_PRESETS[type];
    setResultMetric({
      type,
      resultLabel: preset.resultLabel,
      costLabel: preset.costLabel,
      behavior: preset.behavior,
    });
  }

  function setLayout(patch: Partial<typeof layout>) {
    setConfig((c) => ({ ...c, layout: { ...c.layout, ...patch } }));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await saveDashboardConfig(clientId, config);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar dashboard"
      description="Configuração salva por cliente em dashboard_configs."
      className="max-w-3xl"
    >
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Métrica principal
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Tipo</label>
              <Select
                options={RESULT_METRIC_TYPES.map((t) => ({
                  value: t,
                  label: RESULT_METRIC_TYPE_LABEL[t],
                }))}
                value={resultMetric.type}
                onChange={(e) => onTypeChange(e.target.value as ResultMetricType)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Nome exibido
              </label>
              <Input
                value={resultMetric.resultLabel}
                onChange={(e) => setResultMetric({ resultLabel: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Comportamento
              </label>
              <Select
                options={METRIC_BEHAVIORS.map((b) => ({
                  value: b,
                  label: METRIC_BEHAVIOR_LABEL[b],
                }))}
                value={resultMetric.behavior}
                onChange={(e) =>
                  setResultMetric({ behavior: e.target.value as MetricBehavior })
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Custo por resultado: <span className="text-foreground">
              {resultMetric.costLabel}
            </span>{" "}
            · sempre tratado como “quanto menor, melhor”.
          </p>
        </section>

        <ReorderableList
          title="Cards"
          hint="Ative, desative e reordene os cards do dashboard."
          items={layout.cards}
          catalog={CARD_CATALOG}
          onChange={(cards) => setLayout({ cards })}
        />

        <ReorderableList
          title="Gráficos"
          hint="Escolha e ordene os gráficos exibidos."
          items={layout.charts}
          catalog={CHART_CATALOG}
          onChange={(charts) => setLayout({ charts })}
        />

        <ReorderableList
          title="Colunas da tabela de campanhas"
          hint="A coluna Campanha é obrigatória."
          items={layout.tableColumns}
          catalog={TABLE_COLUMN_CATALOG}
          requiredKey={REQUIRED_TABLE_COLUMN}
          onChange={(tableColumns) => setLayout({ tableColumns })}
        />

        {error && <p className="text-sm text-negative">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="button" loading={pending} onClick={handleSave}>
          Salvar dashboard
        </Button>
      </div>
    </Modal>
  );
}
