import { Badge } from "@/components/ui/badge";
import type { HealthCounts } from "@/lib/meta/agency-overview";

interface Item {
  key: string;
  text: string;
  tone: "positive" | "warning" | "negative" | "muted";
}

/**
 * Contagem compacta de saúde da operação — direto de `meta_client_sync_health`
 * agregada por `summarizeHealth` (nenhum health paralelo/inventado).
 */
export function HealthSummary({ health }: { health: HealthCounts }) {
  const items: Item[] = [
    { key: "fresh", text: `${health.fresh} atualizados`, tone: "positive" },
    { key: "stale", text: `${health.stale} atrasados`, tone: "warning" },
    { key: "never", text: `${health.never} nunca sincronizados`, tone: "muted" },
    {
      key: "sync-problem",
      text: `${health.lastSyncProblem} com problema na última sync`,
      tone: "negative",
    },
    {
      key: "meta-attention",
      text: `${health.metaNeedsAttention} com Meta desconectada/reautorização`,
      tone: "warning",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.key} tone={item.tone} dot>
          {item.text}
        </Badge>
      ))}
    </div>
  );
}
