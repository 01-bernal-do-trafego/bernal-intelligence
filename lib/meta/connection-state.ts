/**
 * Estado da conexão Meta de um cliente, para a UI. Módulo PURO.
 *
 * Fonte da verdade: a linha em `public.meta_connections` (lida via RLS pelo
 * app — a tabela NÃO tem token). O enum do banco
 * (`public.meta_connection_status`) é traduzido aqui para os estados visuais.
 *
 *   banco (meta_connection_status)     -> estado de UI
 *   (sem linha)                        -> not_connected
 *   has_secret = false                 -> reconnect   (conexão iniciada, sem token)
 *   active                             -> connected
 *   expiring                           -> expiring
 *   expired                            -> expired
 *   revoked                            -> revoked
 *   reauthorization_required           -> reconnect
 *
 * `connecting` é um estado transitório reservado (fluxo de redirect completo
 * não passa por ele de forma visível; fica disponível para polling futuro).
 */

export type MetaUiState =
  | "not_connected"
  | "connecting"
  | "connected"
  | "expiring"
  | "expired"
  | "revoked"
  | "reconnect"
  | "error";

/** Espelho do enum `public.meta_connection_status`. */
export type MetaDbStatus =
  | "active"
  | "expiring"
  | "expired"
  | "revoked"
  | "reauthorization_required";

export const META_UI_LABEL: Record<MetaUiState, string> = {
  not_connected: "Não conectado",
  connecting: "Conectando…",
  connected: "Meta conectado",
  expiring: "Conexão expirando",
  expired: "Conexão expirada",
  revoked: "Acesso revogado",
  reconnect: "Reconexão necessária",
  error: "Erro de conexão",
};

/** Tom do badge — union local para manter o módulo puro e independente da UI. */
export type MetaBadgeTone = "positive" | "muted" | "negative" | "warning";

export const META_UI_TONE: Record<MetaUiState, MetaBadgeTone> = {
  not_connected: "muted",
  connecting: "warning",
  connected: "positive",
  expiring: "warning",
  expired: "negative",
  revoked: "negative",
  reconnect: "warning",
  error: "negative",
};

export function parseMetaDbStatus(value: unknown): MetaDbStatus | null {
  return value === "active" ||
    value === "expiring" ||
    value === "expired" ||
    value === "revoked" ||
    value === "reauthorization_required"
    ? value
    : null;
}

export interface MetaConnectionRowLike {
  status: unknown;
  has_secret?: unknown;
}

/** Deriva o estado de UI a partir da linha de `meta_connections` (ou `null`). */
export function metaUiStateFromRow(row: MetaConnectionRowLike | null | undefined): MetaUiState {
  if (!row) return "not_connected";
  if (row.has_secret === false) return "reconnect";

  const status = parseMetaDbStatus(row.status);
  switch (status) {
    case "active":
      return "connected";
    case "expiring":
      return "expiring";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    case "reauthorization_required":
      return "reconnect";
    default:
      return "error";
  }
}

/** Uma conexão "utilizável" para sincronizar (ainda que perto de expirar). */
export function metaIsUsable(state: MetaUiState): boolean {
  return state === "connected" || state === "expiring";
}

/** Precisa de ação do usuário (conectar/reconectar). */
export function metaNeedsAction(state: MetaUiState): boolean {
  return (
    state === "not_connected" ||
    state === "expired" ||
    state === "revoked" ||
    state === "reconnect" ||
    state === "error"
  );
}

/**
 * Rótulo do botão de ação, ou `null` quando nenhum botão deve aparecer.
 * `expiring` também oferece reconectar (renovação antecipada).
 */
export function metaButtonLabel(state: MetaUiState): string | null {
  if (state === "not_connected") return "Conectar Meta Ads";
  if (state === "connecting" || state === "connected") return null;
  return "Reconectar Meta Ads";
}
