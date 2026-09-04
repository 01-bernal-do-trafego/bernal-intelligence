import { formatRelativeTime } from "@/lib/relative-time";

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
            {attentionCount} {attentionCount === 1 ? "cliente precisa" : "clientes precisam"} de
            atenção
          </span>
        </>
      )}
    </p>
  );
}
