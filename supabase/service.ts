import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Client Supabase com a chave `service_role` — bypassa RLS totalmente.
 *
 * Até esta feature, o app Next.js NUNCA usava `service_role` (ver
 * `supabase/migrations/20260901120000_phase2_foundation.sql`, seção 7: "o
 * app NUNCA o usa"). O dashboard compartilhável é a primeira exceção
 * deliberada, e só existe DENTRO do `supabase/share-context.ts`: uma visita
 * pública a `/share/<token>` não tem `auth.uid()` para a RLS avaliar, então
 * não há como reaproveitar o query layer existente (que é todo escrito
 * contra a sessão do usuário) sem um client que não dependa de sessão.
 *
 * Este client NUNCA é criado a partir do browser (arquivo `server-only`,
 * só importado por `supabase/server.ts` dentro do contexto de share e por
 * `server/share-link.ts` para resolver o token). A autorização real não é
 * este client — é o próprio token, validado ANTES de qualquer leitura (ver
 * `server/share-link.ts#resolveShareToken`), e todo dado lido a partir daqui
 * já é implicitamente escopado ao `client_id` resolvido do token (as mesmas
 * funções do query layer que a UI administrativa usa, cada uma já filtrando
 * por `client_id`/`clientId` explícito — nunca um SELECT sem filtro).
 */
function resolveSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Secret ausente: SUPABASE_SECRET_KEY. Necessária apenas para o dashboard " +
        "compartilhável (/share/<token>) — nunca é lida fora desse fluxo.",
    );
  }
  return key;
}

export function createSupabaseServiceClient() {
  return createClient(SUPABASE_URL, resolveSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
