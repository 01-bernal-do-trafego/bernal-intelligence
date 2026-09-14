"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import {
  deactivateShareLink,
  regenerateShareLink,
} from "@/app/(app)/clients/[id]/share-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";

interface ShareLinkModalProps {
  clientId: string;
  /** Já existe um link ativo (lido no servidor, RLS normal) — mas o token em
   *  claro nunca é lido de volta do banco ("revelar uma vez"), então mesmo
   *  com `initialActive: true` não há URL para mostrar até gerar/regenerar
   *  NESTA sessão do navegador. */
  initialActive: boolean;
}

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * "Revelar uma vez": a URL completa só aparece no instante em que é
 * gerada/regenerada (`revealedToken` só existe em memória do componente,
 * nunca persistido/relido). Reabrir o modal depois só mostra "Link ativo" +
 * Regenerar/Desativar — mesmo padrão de chave de API do GitHub/Stripe.
 */
export function ShareLinkModal({ clientId, initialActive }: ShareLinkModalProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(initialActive);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const shareUrl =
    revealedToken && typeof window !== "undefined"
      ? `${window.location.origin}/share/${revealedToken}`
      : null;

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const res = await regenerateShareLink(clientId);
      if (!res.ok) {
        setError("Não foi possível gerar o link. Tente novamente.");
        return;
      }
      setActive(true);
      setRevealedToken(res.token);
      setCopied(false);
    });
  }

  function onDeactivate() {
    setError(null);
    startTransition(async () => {
      const res = await deactivateShareLink(clientId);
      if (!res.ok) {
        setError("Não foi possível desativar o link. Tente novamente.");
        return;
      }
      setActive(false);
      setRevealedToken(null);
      setCopied(false);
    });
  }

  async function onCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar automaticamente. Copie o link manualmente.");
    }
  }

  function onClose() {
    setOpen(false);
    setError(null);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Share2 className="size-3.5" />
        Compartilhar
      </Button>

      <Modal
        open={open}
        onClose={onClose}
        title="Compartilhar dashboard"
        description={
          active
            ? undefined
            : "Crie um link somente leitura para este cliente."
        }
        footer={
          <>
            {active && (
              <Button variant="danger" size="sm" onClick={onDeactivate} disabled={pending}>
                Desativar
              </Button>
            )}
            <Button
              variant={active ? "secondary" : "primary"}
              size="sm"
              onClick={onGenerate}
              loading={pending}
            >
              {active ? "Regenerar link" : "Gerar link"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {active && (
            <div className="flex items-center gap-2">
              <Badge tone="positive" dot>
                Ativo
              </Badge>
            </div>
          )}

          {shareUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 flex-1 truncate rounded-lg border border-border bg-surface-elevated px-3 font-mono text-xs text-foreground"
                />
                <Button variant="secondary" size="sm" onClick={onCopy}>
                  <Copy className="size-3.5" />
                  Copiar link
                </Button>
              </div>
              {copied && (
                <p className="flex items-center gap-1 text-xs text-positive">
                  <Check className="size-3.5" />
                  Link copiado
                </p>
              )}
              <p className="text-xs text-warning">
                Copie agora — por segurança, não será possível ver esta URL de
                novo. Para vê-la outra vez, regenere o link.
              </p>
            </div>
          ) : active ? (
            <p className="text-sm text-muted">
              Já copiado anteriormente. Para ver a URL de novo, regenere o
              link (isso invalida o anterior).
            </p>
          ) : null}

          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
