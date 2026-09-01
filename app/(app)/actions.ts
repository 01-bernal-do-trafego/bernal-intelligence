"use server";

import { redirect } from "next/navigation";
import { getAuthMode } from "@/supabase/config";
import { createSupabaseServerClient } from "@/supabase/server";

export async function signOut() {
  if (getAuthMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
