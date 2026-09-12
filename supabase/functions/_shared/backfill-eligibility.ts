/**
 * DATA V2.3B — resolução/validação de "conta elegível para trabalhar com
 * Backfill" (conta pertence ao cliente, is_linked, conexão elegível com
 * secret). MESMA regra já usada em `meta-backfill-orchestrator`#handleInspect
 * e `meta-backfill-executor` (checada inline em cada um) — extraída aqui
 * como helper compartilhado para o CÓDIGO NOVO (Discovery) não duplicar essa
 * lógica de novo.
 *
 * Decisão deliberada: `meta-backfill-orchestrator`/`meta-backfill-executor`
 * (já aprovados e no checkpoint `checkpoint-data-foundation-v2.3a`) NÃO
 * foram refatorados para usar este helper — evita reabrir revisão de código
 * já fechado só por redução de duplicação. Qualquer função NOVA a partir de
 * agora deve usar este helper em vez de reimplementar a checagem.
 *
 * MESMA regra de `meta_eligible_ad_accounts` (Auto Sync V1,
 * `20260903193000_meta_auto_sync.sql`): status IN ('active', 'expiring').
 */

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export const ELIGIBLE_CONNECTION_STATUSES = ["active", "expiring"] as const;

export interface EligibleAccount {
  id: string;
  ad_account_id: string;
  connection_id: string;
  currency: string | null;
  timezone_name: string | null;
  client_id: string;
}
export interface EligibleConnection {
  status: string;
  has_secret: boolean;
}

export type EligibilityFailureReason =
  | "client_not_found"
  | "account_not_found_for_client"
  | "account_not_linked"
  | "no_connection"
  | "connection_not_found"
  | "connection_not_eligible";

export type EligibilityResult =
  | { ok: true; account: EligibleAccount; connection: EligibleConnection }
  | { ok: false; reason: EligibilityFailureReason };

/**
 * Resolve e valida `(clientId, adAccountRef)` — cliente existe, conta
 * pertence a ele e está `is_linked`, conexão existe com status
 * `active|expiring` e `has_secret=true`. NUNCA lê `meta_connection_secrets`
 * (isso é responsabilidade exclusiva de quem for de fato decifrar o token —
 * este helper só confirma que HÁ um segredo, nunca o lê).
 */
export async function resolveEligibleAccount(
  admin: AnyClient,
  clientId: string,
  adAccountRef: string,
): Promise<EligibilityResult> {
  const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, reason: "client_not_found" };

  const { data: accRow } = await admin
    .from("meta_ad_accounts")
    .select("id, ad_account_id, connection_id, currency, timezone_name, is_linked, client_id")
    .eq("id", adAccountRef)
    .maybeSingle();
  const acc = accRow as
    | (EligibleAccount & { is_linked: boolean })
    | null;
  if (!acc || acc.client_id !== clientId) {
    return { ok: false, reason: "account_not_found_for_client" };
  }
  if (!acc.is_linked) {
    return { ok: false, reason: "account_not_linked" };
  }
  if (!acc.connection_id) {
    return { ok: false, reason: "no_connection" };
  }

  const { data: connRow } = await admin
    .from("meta_connections")
    .select("status, has_secret")
    .eq("id", acc.connection_id)
    .maybeSingle();
  const conn = connRow as EligibleConnection | null;
  if (!conn) return { ok: false, reason: "connection_not_found" };

  const eligible = ELIGIBLE_CONNECTION_STATUSES.includes(conn.status as (typeof ELIGIBLE_CONNECTION_STATUSES)[number]);
  if (!eligible || !conn.has_secret) {
    return { ok: false, reason: "connection_not_eligible" };
  }

  return { ok: true, account: acc, connection: conn };
}
