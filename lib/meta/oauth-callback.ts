/**
 * Lógica de decisão do callback do OAuth da Meta. Módulo PURO.
 *
 * O route handler só faz a coleta (query, cookie, sessão, acesso ao cliente) e
 * a execução (chamar a Edge Function, redirecionar). TODA a árvore de decisão
 * está aqui, para ser testada isoladamente:
 *
 *   - callback com erro da Meta            -> "denied"
 *   - sessão ausente / não é da agência    -> "forbidden"
 *   - state ausente/adulterado/expirado    -> "invalid_state"
 *   - uid da sessão != uid do state        -> "forbidden"
 *   - callback sem `code`                  -> "missing_code"
 *   - usuário sem acesso ao cliente        -> "forbidden"
 *   - tudo ok                              -> "exchange" (com clientId + code)
 */

import type { StateValidation } from "./oauth-state";
import { describeMetaRedirectError } from "./oauth-errors";

export interface CallbackQuery {
  code?: string | null;
  state?: string | null;
  error?: string | null;
  error_reason?: string | null;
  error_description?: string | null;
}

export interface CallbackSession {
  uid: string | null;
  isAgency: boolean;
}

export type CallbackStateReason = "missing" | "malformed" | "expired" | "nonce_mismatch";

export type CallbackDecision =
  | { kind: "denied"; message: string }
  | { kind: "invalid_state"; reason: CallbackStateReason }
  | { kind: "missing_code" }
  | { kind: "forbidden" }
  | { kind: "exchange"; clientId: string; code: string };

export function decideCallback(args: {
  query: CallbackQuery;
  state: StateValidation;
  session: CallbackSession;
  canAccessClient: boolean;
}): CallbackDecision {
  const { query, state, session, canAccessClient } = args;

  // 1. Erro explícito da Meta (inclui cancelamento do usuário).
  const metaError = describeMetaRedirectError(query);
  if (metaError) return { kind: "denied", message: metaError };

  // 2. Precisa de sessão válida da equipe Bernal.
  if (!session.uid || !session.isAgency) return { kind: "forbidden" };

  // 3. State tem que validar contra o cookie.
  if (!state.ok) return { kind: "invalid_state", reason: state.reason };

  // 4. O fluxo tem que ter sido iniciado por ESTE usuário.
  if (state.uid !== session.uid) return { kind: "forbidden" };

  // 5. Sem `code` (e sem erro da Meta) => callback malformado.
  const code = typeof query.code === "string" ? query.code.trim() : "";
  if (!code) return { kind: "missing_code" };

  // 6. O usuário precisa poder acessar o cliente do state (revalidado no banco).
  if (!canAccessClient) return { kind: "forbidden" };

  return { kind: "exchange", clientId: state.clientId, code };
}
