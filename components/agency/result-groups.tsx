import { formatCurrencyOrDash, formatNumber } from "@/lib/format";
import { plural } from "@/lib/plural";
import type { ResultGroup } from "@/lib/meta/agency-overview";

/** grid adaptado ao nº REAL de grupos — nunca card vazio só para preencher. */
function gridClass(count: number): string {
  if (count === 1) return "grid-cols-1 sm:max-w-sm";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
}

/**
 * "Resultados principais" — 1 card por TIPO de resultado configurado
 * (`dashboard_configs.result_metric`), nunca somando tipos diferentes juntos.
 * Sem grupos -> a seção inteira não renderiza.
 */
export function ResultGroups({ groups }: { groups: readonly ResultGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Resultados principais</h2>
      <div className={`grid gap-4 ${gridClass(groups.length)}`}>
        {groups.map((group) => {
          const partial = group.totalConfiguredCount > group.clientCount;
          return (
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
                {partial
                  ? `${group.clientCount} de ${group.totalConfiguredCount} ${plural(
                      group.totalConfiguredCount,
                      "cliente",
                    )} com dados`
                  : `${group.clientCount} ${plural(group.clientCount, "cliente")}`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
