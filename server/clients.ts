import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/supabase/server";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";
import type { ClientRecord } from "@/types/client";

export interface ListClientsOptions {
  search?: string;
  status?: ClientStatus | "all";
}

const VALID_STATUS = new Set<string>(Object.keys(CLIENT_STATUS_LABEL));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toClientRecord(row: Record<string, unknown>): ClientRecord | null {
  const id = row.id;
  const name = row.name;
  const status = row.status;
  if (typeof id !== "string" || typeof name !== "string") return null;
  if (typeof status !== "string" || !VALID_STATUS.has(status)) return null;

  return {
    id,
    name,
    internalName:
      typeof row.internal_name === "string" && row.internal_name.length > 0
        ? row.internal_name
        : null,
    logoUrl: typeof row.logo_url === "string" ? row.logo_url : null,
    status: status as ClientStatus,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

/** Um cliente real pelo UUID. Cacheado por request (metadata + página). */
export const getClientRecord = cache(
  async (id: string): Promise<ClientRecord | null> => {
    if (!UUID_RE.test(id)) return null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return toClientRecord(data as Record<string, unknown>);
  },
);

/** Lista de clientes reais, filtrada pela RLS da sessão atual. */
export async function listClients(
  options: ListClientsOptions = {},
): Promise<ClientRecord[]> {
  const { search = "", status = "all" } = options;
  const supabase = await createSupabaseServerClient();

  // Filtros ANTES do .order() (o transform builder não expõe .eq/.or).
  let query = supabase.from("clients").select("*");

  if (status !== "all" && VALID_STATUS.has(status)) {
    query = query.eq("status", status);
  }

  const term = search.trim().replace(/[%,()*]/g, "").slice(0, 80);
  if (term) {
    query = query.or(`name.ilike.%${term}%,internal_name.ilike.%${term}%`);
  }

  const { data, error } = await query.order("name", { ascending: true });
  if (error || !data) return [];

  return (data as Record<string, unknown>[])
    .map(toClientRecord)
    .filter((c): c is ClientRecord => c !== null);
}

/** Contagem real de clientes com status "active" (para a Visão geral). */
export async function countActiveClients(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  return error || count == null ? 0 : count;
}
