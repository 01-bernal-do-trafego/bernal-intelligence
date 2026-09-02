/**
 * Resolução das chaves de API do Supabase dentro da Edge Function.
 *
 * Modelo 2026: as chaves legadas `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
 * continuam auto-injetadas (previstas para deprecar no fim de 2026). As novas
 * `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` chegam como JSON
 * `{ "<nome>": "<valor>" }`.
 *
 * Aqui preferimos a legada (zero config, sem `supabase secrets set`) e caímos
 * para a nova quando a legada não existir. NENHUMA delas é cadastrada
 * manualmente pelo usuário; nenhuma vai para o navegador.
 */

function firstFromJsonMap(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferred = parsed["default"];
    if (typeof preferred === "string" && preferred) return preferred;
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value) return value;
    }
  } catch {
    // ignora — trata como ausente
  }
  return null;
}

/** Chave de leitura pública (para o client no contexto do usuário). */
export function resolvePublishableKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const next = firstFromJsonMap(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  if (next) return next;
  throw new Error(
    "Chave publishable ausente (SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEYS).",
  );
}

/** Chave secreta / service_role (para o client administrativo). */
export function resolveSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const next = firstFromJsonMap(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (next) return next;
  throw new Error(
    "Chave secreta ausente (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS).",
  );
}
