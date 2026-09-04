/**
 * Estado Meta AGREGADO de um cliente com N contas / potencialmente N
 * connections. Módulo PURO.
 *
 * A arquitetura suporta 1 cliente -> N `meta_ad_accounts` -> N
 * `meta_connections` distintas (histórico de reconexão). Escolher "a
 * connection mais recente" está ERRADO: uma connection antiga/órfã (nenhuma
 * conta vinculada aponta pra ela) não pode poluir o status do cliente, e uma
 * connection RELEVANTE com problema não pode ser mascarada por outra
 * connection relevante saudável.
 *
 * RELEVANTE = referenciada por pelo menos 1 `meta_ad_accounts` com
 * `is_linked = true`. Connections órfãs/desvinculadas são ignoradas.
 *
 * Prioridade operacional (mais urgente primeiro):
 *   1. revoked / expired / reconnect (reauthorization_required OU sem secret)
 *   2. expiring
 *   3. connected
 *   4. not_connected (nenhuma connection relevante)
 */
import { metaUiStateFromRow, type MetaUiState } from "@/lib/meta/connection-state";

export interface ClientConnectionInfo {
  connectionId: string;
  status: unknown;
  hasSecret: unknown;
}

export interface ClientAccountLinkInfo {
  connectionId: string | null;
  isLinked: boolean;
}

/** da mais urgente pra menos — a 1ª que aparecer entre as connections relevantes vence. */
const PRIORITY: readonly MetaUiState[] = [
  "revoked",
  "expired",
  "reconnect",
  "error",
  "expiring",
  "connected",
];

/**
 * Estado Meta agregado do cliente a partir de TODAS as suas connections e
 * contas. Connections sem nenhuma conta `is_linked=true` apontando pra elas
 * são ignoradas por completo (não pesam no resultado).
 */
export function aggregateClientMetaState(
  connections: readonly ClientConnectionInfo[],
  accounts: readonly ClientAccountLinkInfo[],
): MetaUiState {
  const relevantConnectionIds = new Set(
    accounts
      .filter((a) => a.isLinked && a.connectionId)
      .map((a) => a.connectionId as string),
  );
  if (relevantConnectionIds.size === 0) return "not_connected";

  const relevantStates = connections
    .filter((c) => relevantConnectionIds.has(c.connectionId))
    .map((c) => metaUiStateFromRow({ status: c.status, has_secret: c.hasSecret }));
  if (relevantStates.length === 0) return "not_connected";

  for (const p of PRIORITY) {
    if (relevantStates.includes(p)) return p;
  }
  return "not_connected";
}
