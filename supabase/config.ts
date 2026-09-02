/**
 * Configuração e modo de autenticação.
 *
 * - `supabase`     : variáveis presentes -> autenticação real (Supabase Auth).
 * - `demo`         : sem variáveis, apenas em desenvolvimento -> modo
 *                    demonstração para rodar a UI localmente.
 * - `unconfigured` : sem variáveis em produção -> acesso negado (nunca há
 *                    bypass de autenticação em produção).
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Base das Edge Functions. Derivada da URL do projeto por padrão
 * (`<ref>.supabase.co/functions/v1`); pode ser sobrescrita para o runtime
 * local (`supabase functions serve`) via `SUPABASE_FUNCTIONS_URL`.
 */
export const SUPABASE_FUNCTIONS_URL =
  process.env.SUPABASE_FUNCTIONS_URL ??
  (SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1` : "");

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
}

export type AuthMode = "supabase" | "demo" | "unconfigured";

export function getAuthMode(): AuthMode {
  if (isSupabaseConfigured()) return "supabase";
  if (process.env.NODE_ENV !== "production") return "demo";
  return "unconfigured";
}
