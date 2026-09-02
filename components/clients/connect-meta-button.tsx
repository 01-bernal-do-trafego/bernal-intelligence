import { cn } from "@/lib/cn";
import { metaButtonLabel, type MetaUiState } from "@/lib/meta/connection-state";

/**
 * Botão "Conectar Meta Ads" / "Reconectar Meta Ads".
 *
 * É um link puro (navegação de página inteira) para `/api/meta/oauth/start`,
 * que valida a sessão no servidor e redireciona para a Meta. Sem JS.
 * Não renderiza nada quando o estado já está conectado / em progresso.
 */
export function ConnectMetaButton({
  clientId,
  state,
  className,
}: {
  clientId: string;
  state: MetaUiState;
  className?: string;
}) {
  const label = metaButtonLabel(state);
  if (!label) return null;

  const primary = state === "not_connected";

  return (
    <a
      href={`/api/meta/oauth/start?clientId=${encodeURIComponent(clientId)}`}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55",
        primary
          ? "bg-accent text-accent-contrast hover:bg-accent-hover"
          : "border border-border bg-surface-elevated text-foreground hover:border-muted/40",
        className,
      )}
    >
      {label}
    </a>
  );
}
