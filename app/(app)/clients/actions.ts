"use server";

import { revalidatePath } from "next/cache";
import { isAgencyRole } from "@/lib/roles";
import {
  ARCHIVE_STATUS,
  parseClientInput,
  type ClientInput,
} from "@/lib/client-input";
import { getSessionContext } from "@/supabase/auth";
import { createSupabaseServerClient } from "@/supabase/server";

export type ClientActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

interface PostgrestErrorLike {
  message?: string;
  code?: string;
}

async function requireAgency(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const { user, profile } = await getSessionContext();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (!profile || !isAgencyRole(profile.role)) {
    return {
      ok: false,
      error: "Você não tem permissão para gerenciar clientes.",
    };
  }
  return { ok: true };
}

function friendlyError(error: PostgrestErrorLike | null): string {
  const message = error?.message ?? "";
  if (error?.code === "42501" || /row-level security/i.test(message)) {
    return "Permissão negada pelo banco (RLS).";
  }
  if (/check constraint/i.test(message)) {
    return "Dados inválidos para o cliente.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}

function revalidateClient(id?: string) {
  revalidatePath("/clients");
  revalidatePath("/");
  if (id) revalidatePath(`/clients/${id}`);
}

export async function createClient(
  input: ClientInput,
): Promise<ClientActionResult> {
  const auth = await requireAgency();
  if (!auth.ok) return auth;

  const parsed = parseClientInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      name: parsed.value.name,
      internal_name: parsed.value.internalName,
      status: parsed.value.status,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: friendlyError(error) };

  const id = (data as { id: string }).id;
  revalidateClient(id);
  return { ok: true, id };
}

export async function updateClient(
  id: string,
  input: ClientInput,
): Promise<ClientActionResult> {
  const auth = await requireAgency();
  if (!auth.ok) return auth;

  const parsed = parseClientInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update({
      name: parsed.value.name,
      internal_name: parsed.value.internalName,
      status: parsed.value.status,
    })
    .eq("id", id);

  if (error) return { ok: false, error: friendlyError(error) };

  revalidateClient(id);
  return { ok: true, id };
}

/** Arquiva o cliente (status = 'archived'). Não apaga do banco. */
export async function archiveClient(id: string): Promise<ClientActionResult> {
  const auth = await requireAgency();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update({ status: ARCHIVE_STATUS })
    .eq("id", id);

  if (error) return { ok: false, error: friendlyError(error) };

  revalidateClient(id);
  return { ok: true, id };
}
