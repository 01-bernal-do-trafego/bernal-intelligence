"use server";

import { revalidatePath } from "next/cache";
import { isAgencyRole } from "@/lib/roles";
import { generateShareToken, hashShareToken } from "@/lib/share-token";
import { getSessionContext } from "@/supabase/auth";
import { createSupabaseServerClient } from "@/supabase/server";
import { getClientRecord } from "@/server/clients";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Gestão do link (gerar/regenerar/desativar) roda na sessão normal do
 * ADMIN (RLS via `createSupabaseServerClient()`, sem service_role — quem
 * gerencia o link já está autenticado e autorizado). Só a LEITURA pública
 * em `/share/<token>` usa service_role (ver `server/share-link.ts`).
 *
 * `getClientRecord(clientId)` dupla função aqui: além de buscar o registro,
 * sua RLS (`clients_select_accessible`) já é a checagem de autorização —
 * `null` tanto para "não existe" quanto "existe mas não é meu", como em
 * `meta-sync-actions.ts`. Nunca confiamos só no clientId vindo do form.
 */

export type ShareLinkActionResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export type ShareLinkDeactivateResult =
  | { ok: true }
  | { ok: false; reason: string };

async function requireManageableClient(clientId: string) {
  const { user, profile } = await getSessionContext();
  if (!user) return { ok: false as const, reason: "session" };
  if (!profile || !isAgencyRole(profile.role)) {
    return { ok: false as const, reason: "forbidden" };
  }
  const client = await getClientRecord(clientId);
  if (!client) return { ok: false as const, reason: "not_found" };
  return { ok: true as const };
}

/**
 * Gera um novo link (ou regenera o existente — mesma operação, sempre um
 * upsert na mesma linha, `client_id` é a PK). O token em claro só existe
 * nesta resposta; nunca é lido de volta do banco depois disso.
 */
export async function regenerateShareLink(
  clientId: string,
): Promise<ShareLinkActionResult> {
  const guard = await requireManageableClient(clientId);
  if (!guard.ok) return guard;

  const { user } = await getSessionContext();
  const token = generateShareToken();
  const tokenHash = hashShareToken(token);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("dashboard_share_links").upsert(
    {
      client_id: clientId,
      token_hash: tokenHash,
      is_active: true,
      created_by: user?.id ?? null,
    },
    { onConflict: "client_id" },
  );
  if (error) return { ok: false, reason: "write_failed" };

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, token };
}

/** Desativa o link ativo do cliente (se houver). Idempotente. */
export async function deactivateShareLink(
  clientId: string,
): Promise<ShareLinkDeactivateResult> {
  const guard = await requireManageableClient(clientId);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("dashboard_share_links")
    .update({ is_active: false })
    .eq("client_id", clientId);
  if (error) return { ok: false, reason: "write_failed" };

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
