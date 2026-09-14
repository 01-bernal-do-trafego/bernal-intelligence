import type { Metadata } from "next";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Mensagem NEUTRA para qualquer token inválido/inexistente/desativado —
 * de propósito, NUNCA diz qual dos três (nem se o cliente existe, nem UUID,
 * nem detalhe de banco). `resolveShareToken` já trata os 3 casos de forma
 * indistinguível antes de chegar aqui.
 */
export const metadata: Metadata = {
  title: "Dashboard indisponível",
  robots: { index: false, follow: false },
};

export default function ShareNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="size-2.5 rounded-full bg-accent" />
        <p className="text-sm font-medium text-foreground">
          Este dashboard não está disponível.
        </p>
        <p className="text-xs text-muted">
          O link pode ter sido desativado ou não existir mais.
        </p>
      </div>
    </div>
  );
}
