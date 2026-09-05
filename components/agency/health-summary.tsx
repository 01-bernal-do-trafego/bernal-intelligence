import { Badge } from "@/components/ui/badge";
import { plural } from "@/lib/plural";
import type { HealthCounts } from "@/lib/meta/agency-overview";

type Tone = "positive" | "warning" | "negative" | "muted";

interface Item {
  key: string;
  count: number;
  text: string;
  /** tom quando count > 0; count 0 fica sempre discreto. */
  tone: Tone;
}

/**
 * Contagem compacta de saúde da operação — direto de `meta_client_sync_health`
 * agregada por `summarizeHealth` (nenhum health paralelo/inventado). Estados
 * com 0 ficam discretos; estados de atenção (>0) mantêm o destaque.
 */
export function HealthSummary({ health }: { health: HealthCounts }) {
  const items: Item[] = [
    {
      key: "fresh",
      count: health.fresh,
      text: `${health.fresh} ${plural(health.fresh, "atualizado")}`,
      tone: "positive",
    },
    {
      key: "stale",
      count: health.stale,
      text: `${health.stale} ${plural(health.stale, "atrasado")}`,
      tone: "warning",
    },
    {
      key: "never",
      count: health.never,
      text: `${health.never} ${plural(health.never, "nunca sincronizado")}`,
      tone: "muted",
    },
    {
      key: "sync-problem",
      count: health.lastSyncProblem,
      text: `${health.lastSyncProblem} com problema na última sync`,
      tone: "negative",
    },
    {
      key: "meta-attention",
      count: health.metaNeedsAttention,
      text: `${health.metaNeedsAttention} com Meta desconectada/reautorização`,
      tone: "warning",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.key} tone={item.count > 0 ? item.tone : "muted"} dot>
          {item.text}
        </Badge>
      ))}
    </div>
  );
}
