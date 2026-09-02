/**
 * Vinculação de contas de anúncio a um cliente. Módulo PURO.
 *
 * "descoberta"  = linha em meta_ad_accounts com is_linked = false
 * "selecionada" = is_linked = true
 *
 * Trava dura (no banco): índice único `meta_ad_accounts_linked_global_uq`
 * em (ad_account_id) where is_linked  => uma conta linkada pertence a no
 * máximo UM cliente. Aqui reproduzimos essa regra para dar erro amigável
 * ANTES de tentar o INSERT.
 */

export interface LinkableRowLike {
  adAccountId: string;
  /** cliente dono desta linha */
  clientId: string;
  isLinked: boolean;
}

export interface LinkPartition {
  /** ids que podem ser linkados a `clientId` */
  linkable: string[];
  /** ids barrados por já estarem linkados a outro cliente */
  blocked: Array<{ adAccountId: string; ownedByClientId: string }>;
  /** ids pedidos que não existem na descoberta deste cliente */
  unknown: string[];
}

/**
 * Divide os ids pedidos em linkáveis / bloqueados / desconhecidos.
 * `rows` deve conter as linhas de descoberta visíveis (todas as conexões).
 */
export function partitionLinkRequest(args: {
  requestedIds: readonly string[];
  clientId: string;
  rows: readonly LinkableRowLike[];
}): LinkPartition {
  const { requestedIds, clientId, rows } = args;

  const requested = [...new Set(requestedIds)];
  const ownForClient = new Set(
    rows.filter((r) => r.clientId === clientId).map((r) => r.adAccountId),
  );
  const linkedElsewhere = new Map<string, string>();
  for (const r of rows) {
    if (r.isLinked && r.clientId !== clientId) {
      linkedElsewhere.set(r.adAccountId, r.clientId);
    }
  }

  const linkable: string[] = [];
  const blocked: LinkPartition["blocked"] = [];
  const unknown: string[] = [];

  for (const id of requested) {
    if (linkedElsewhere.has(id)) {
      blocked.push({ adAccountId: id, ownedByClientId: linkedElsewhere.get(id)! });
    } else if (!ownForClient.has(id)) {
      unknown.push(id);
    } else {
      linkable.push(id);
    }
  }

  return { linkable, blocked, unknown };
}

// ---------------------------------------------------------------------------
// Reconexão: transferência da conta entre conexões do MESMO cliente.
//
// Modela exatamente o que a RPC meta_set_linked_accounts faz numa transação.
// Usado nos testes (a RPC é a aplicação real) e disponível para preview na UI.
// ---------------------------------------------------------------------------

export interface DiscoveryRow {
  adAccountId: string;
  clientId: string;
  /** null quando a conexão que descobriu a conta foi removida. */
  connectionId: string | null;
  isLinked: boolean;
}

export interface LinkTransferPlan {
  /** ids barrados: linkados a OUTRO cliente. Se não vazio, a RPC aborta tudo. */
  blocked: Array<{ adAccountId: string; ownedByClientId: string }>;
  /** ids pedidos que não estão na descoberta da conexão-alvo. RPC aborta. */
  unknown: string[];
  /** linhas de conexões antigas do MESMO cliente a soltar (is_linked=false). */
  releaseFromOtherConnections: Array<{
    adAccountId: string;
    connectionId: string | null;
  }>;
  /** ids que ficam is_linked=true na conexão-alvo. */
  link: string[];
  /** ids da conexão-alvo hoje linkados que saem da seleção (is_linked=false). */
  unlinkOnTarget: string[];
}

export function planLinkTransfer(args: {
  requestedIds: readonly string[];
  clientId: string;
  connectionId: string;
  /** TODAS as linhas de descoberta (todos os clientes e conexões). */
  rows: readonly DiscoveryRow[];
}): LinkTransferPlan {
  const { clientId, connectionId, rows } = args;
  const requested = [...new Set(args.requestedIds)];

  const targetRows = rows.filter(
    (r) => r.clientId === clientId && r.connectionId === connectionId,
  );
  const targetIds = new Set(targetRows.map((r) => r.adAccountId));

  const linkedElsewhere = new Map<string, string>();
  for (const r of rows) {
    if (r.isLinked && r.clientId !== clientId) {
      linkedElsewhere.set(r.adAccountId, r.clientId);
    }
  }

  const blocked: LinkTransferPlan["blocked"] = [];
  const unknown: string[] = [];
  const link: string[] = [];
  const releaseFromOtherConnections: LinkTransferPlan["releaseFromOtherConnections"] =
    [];

  for (const id of requested) {
    if (linkedElsewhere.has(id)) {
      blocked.push({ adAccountId: id, ownedByClientId: linkedElsewhere.get(id)! });
      continue;
    }
    if (!targetIds.has(id)) {
      unknown.push(id);
      continue;
    }
    link.push(id);
    for (const r of rows) {
      if (
        r.adAccountId === id &&
        r.clientId === clientId &&
        r.connectionId !== connectionId &&
        r.isLinked
      ) {
        releaseFromOtherConnections.push({
          adAccountId: id,
          connectionId: r.connectionId,
        });
      }
    }
  }

  const requestedSet = new Set(requested);
  const unlinkOnTarget = targetRows
    .filter((r) => r.isLinked && !requestedSet.has(r.adAccountId))
    .map((r) => r.adAccountId);

  return {
    blocked,
    unknown,
    releaseFromOtherConnections,
    link,
    unlinkOnTarget,
  };
}

export interface LinkSelectionDiff {
  toLink: string[];
  toUnlink: string[];
  unchanged: string[];
}

/** Diferença entre o que já está linkado e a nova seleção (para o cliente). */
export function diffLinkSelection(args: {
  currentlyLinked: readonly string[];
  desired: readonly string[];
}): LinkSelectionDiff {
  const current = new Set(args.currentlyLinked);
  const desired = new Set(args.desired);

  const toLink = [...desired].filter((id) => !current.has(id));
  const toUnlink = [...current].filter((id) => !desired.has(id));
  const unchanged = [...desired].filter((id) => current.has(id));

  return { toLink, toUnlink, unchanged };
}
