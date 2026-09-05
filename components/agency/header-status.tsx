import { formatRelativeTime } from "@/lib/relative-time";
import { plural } from "@/lib/plural";

/**
 * Linha de status no topo da Visão Geral — baseada no health REAL
 * (`meta_client_sync_health`), nunca um número fixo/mock.
 */
export function HeaderStatus({
  lastUpdatedAt,
  attentionCount,
}: {
  lastUpdatedAt: string | null;
  attentionCount: number;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>
        Última atualização da operação:{" "}
        <span className="text-foreground">{formatRelativeTime(lastUpdatedAt)}</span>
      </span>
      {attentionCount > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="text-warning">
            {attentionCount} {plural(attentionCount, "cliente")}{" "}
            {plural(attentionCount, "precisa", "precisam")} de atenção
          </span>
        </>
      )}
    </p>
  );
}
