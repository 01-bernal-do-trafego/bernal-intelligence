import "server-only";

import { createSupabaseServerClient } from "@/supabase/server";
import { SUPABASE_FUNCTIONS_URL } from "@/supabase/config";

export type MetaFunctionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

/**
 * Chama uma Edge Function da Meta server-to-server, com o access token da
 * sessão atual no header Authorization. O token da Meta e os segredos NUNCA
 * transitam por aqui — a função devolve só metadados.
 *
 * `reason` padroniza o erro para a UI:
 *   session | function_unavailable | <reason da função> | unknown
 */
export async function callMetaFunction<T = unknown>(
  name: string,
  payload: Record<string, unknown>,
): Promise<MetaFunctionResult<T>> {
  if (!SUPABASE_FUNCTIONS_URL) return { ok: false, reason: "function_unavailable" };

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return { ok: false, reason: "session" };

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "function_unavailable" };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const reason =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "unknown";
    return { ok: false, reason };
  }

  return { ok: true, data: json as T };
}
