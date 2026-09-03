import type { ClientSyncHealth } from "@/server/meta-sync-health";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

const PERF: Record<string, { label: string; tone: string }> = {
  fresh: { label: "Atualizados", tone: "text-positive" },
  stale: { label: "Atrasados", tone: "text-warning" },
  never: { label: "Nunca sincronizados", tone: "text-muted" },
};
const LAST: Record<string, { label: string; tone: string }> = {
  success: { label: "OK", tone: "text-positive" },
  partial: { label: "Parcial", tone: "text-warning" },
  failed: { label: "Falhou", tone: "text-negative" },
  running: { label: "Em andamento", tone: "text-muted" },
  never: { label: "—", tone: "text-muted" },
};
const CRE: Record<string, { label: string; tone: string }> = {
  ok: { label: "Atualizados", tone: "text-positive" },
  partial: { label: "Parcial", tone: "text-warning" },
  failed: { label: "Falha", tone: "text-negative" },
  unknown: { label: "—", tone: "text-muted" },
  never: { label: "Ainda não sincronizados", tone: "text-muted" },
};

/**
 * Três eixos SEPARADOS de estado da sincronização — performance freshness NÃO
 * é afetada por uma tentativa que falhou; creatives é independente.
 */
export function SyncHealthLines({ health }: { health: ClientSyncHealth | null }) {
  if (!health) {
    return (
      <p className="text-xs text-muted">
        Sincronização automática: <span className="text-foreground">ativa</span>{" "}
        (a cada ~4h). Ainda sem histórico de sincronização.
      </p>
    );
  }
  const perf = PERF[health.performanceStatus] ?? PERF.never;
  const last = LAST[health.lastSyncStatus] ?? LAST.never;
  const cre = CRE[health.creativesStatus] ?? CRE.unknown;
  return (
    <div className="grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-3">
      <span>
        Dados de performance:{" "}
        <span className={perf.tone}>{perf.label}</span>
        {health.performanceStatus !== "never" && health.performanceSyncedAt
          ? ` · ${ago(health.performanceSyncedAt)}`
          : ""}
      </span>
      <span>
        Criativos: <span className={cre.tone}>{cre.label}</span>
      </span>
      <span>
        Última sincronização: <span className={last.tone}>{last.label}</span>
        {health.lastSyncAt ? ` · ${ago(health.lastSyncAt)}` : ""}
      </span>
      <span className="sm:col-span-3">
        Sincronização automática:{" "}
        <span className="text-foreground">ativa</span> (a cada ~4h) · o botão
        manual continua disponível.
      </span>
    </div>
  );
}
