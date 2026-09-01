import type { Metadata } from "next";
import { getAuthMode, isSupabaseConfigured } from "@/supabase/config";
import { ComingSoon } from "@/components/shared/coming-soon";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Configurações" };

const MODE_LABEL: Record<ReturnType<typeof getAuthMode>, string> = {
  supabase: "Supabase Auth",
  demo: "Modo demonstração (local)",
  unconfigured: "Não configurado",
};

export default function SettingsPage() {
  const mode = getAuthMode();

  return (
    <ComingSoon
      title="Configurações"
      description="Preferências da conta, membros da equipe e integrações chegam em uma fase futura."
    >
      <div className="mt-6 flex items-center justify-center gap-2 text-sm">
        <span className="text-muted">Autenticação:</span>
        <Badge tone={isSupabaseConfigured() ? "positive" : "muted"}>
          {MODE_LABEL[mode]}
        </Badge>
      </div>
    </ComingSoon>
  );
}
