import "server-only";

import { cache } from "react";
import {
  parseDashboardConfig,
  type DashboardConfigValue,
} from "@/lib/dashboard-config";
import { createSupabaseServerClient } from "@/supabase/server";

/**
 * Configuração de dashboard de um cliente, lida de `public.dashboard_configs`
 * pela sessão atual (RLS). Sempre devolve um valor válido — se o JSON estiver
 * vazio, parcial ou inválido, cai na configuração padrão segura.
 * Cacheada por request (usada pela página e pelo editor).
 */
export const getDashboardConfig = cache(
  async (clientId: string): Promise<DashboardConfigValue> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("dashboard_configs")
      .select("result_metric, layout")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error || !data) return parseDashboardConfig(null);

    const row = data as Record<string, unknown>;
    return parseDashboardConfig({
      result_metric: row.result_metric,
      layout: row.layout,
    });
  },
);
