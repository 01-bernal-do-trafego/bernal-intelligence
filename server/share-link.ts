import "server-only";

import { cache } from "react";
import { getAuthMode } from "@/supabase/config";
import { createSupabaseServerClient } from "@/supabase/server";
import { createSupabaseServiceClient } from "@/supabase/service";
import { hashShareToken, isPlausibleShareToken } from "@/lib/share-token";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Dois papéis distintos, NUNCA confundidos:
 *   - `getShareLinkState`  : lido pela UI ADMINISTRATIVA (RLS normal, via
 *     `createSupabaseServerClient()` na sessão do agency member) — só diz se
 *     HÁ um link ativo, nunca expõe hash/token.
 *   - `resolveShareToken`  : chamado pela rota PÚBLICA `/share/<token>`,
 *     ANTES de qualquer sessão/contexto existir — usa `service_role`
 *     diretamente (não há RLS que uma visita anônima possa satisfazer) para
 *     comparar o hash do token recebido. Nunca aceita/usa um clientId vindo
 *     do chamador; o único retorno possível é o clientId QUE O TOKEN RESOLVE,
 *     ou `null`.
 */

export interface ShareLinkState {
  active: boolean;
}

/** Estado do link (só se HÁ um ativo) — para a UI administrativa. RLS normal. */
export const getShareLinkState = cache(
  async (clientId: string): Promise<ShareLinkState> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("dashboard_share_links")
      .select("is_active")
      .eq("client_id", clientId)
      .maybeSingle();
    const row = data as { is_active: boolean } | null;
    return { active: row?.is_active === true };
  },
);

/**
 * Resolve um token opaco recebido em `/share/<token>` para o `client_id` que
 * ele autoriza — ou `null` se o token for inválido, inexistente, desativado,
 * ou se QUALQUER coisa falhar na resolução (nunca lança; falha sempre fecha
 * para "indisponível", nunca abre). Fora do modo `supabase` (demo/unconfigured
 * — sem Supabase real configurado) sempre retorna `null`.
 */
export const resolveShareToken = cache(async function resolveShareToken(
  rawToken: string,
): Promise<{ clientId: string } | null> {
  if (getAuthMode() !== "supabase") return null;
  if (!isPlausibleShareToken(rawToken)) return null;

  try {
    const admin = createSupabaseServiceClient();
    const tokenHash = hashShareToken(rawToken);
    const { data, error } = await admin
      .from("dashboard_share_links")
      .select("client_id")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return null;
    const clientId = (data as { client_id?: unknown }).client_id;
    if (typeof clientId !== "string" || clientId.length === 0) return null;

    // Best-effort — nunca bloqueia/derruba a resposta por causa disto, e
    // nunca deixa uma rejeição não tratada (.then com os 2 handlers).
    void admin
      .from("dashboard_share_links")
      .update({ last_accessed_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .then(
        () => {},
        () => {},
      );

    return { clientId };
  } catch {
    return null;
  }
});
