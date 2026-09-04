import { formatCurrencyOrDash, formatNumber } from "@/lib/format";
import type { ResultGroup } from "@/lib/meta/agency-overview";

/**
 * "Resultados principais" — 1 card por TIPO de resultado configurado
 * (`dashboard_configs.result_metric`), nunca somando tipos diferentes juntos.
 * Sem grupos -> a seção inteira não renderiza (nunca card vazio de métrica
 * que não existe na operação).
 */
export function ResultGroups({ groups }: { groups: readonly ResultGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Resultados principais</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div
            key={group.canonicalId}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              {group.label}
            </span>
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatNumber(group.results)}
            </span>
            <span className="text-xs text-muted">
              Custo por resultado: {formatCurrencyOrDash(group.costPerResult)} ·{" "}
              {group.clientCount} {group.clientCount === 1 ? "cliente" : "clientes"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
