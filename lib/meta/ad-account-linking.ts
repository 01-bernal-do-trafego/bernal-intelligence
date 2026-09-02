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
