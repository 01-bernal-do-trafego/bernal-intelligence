import type { Metadata } from "next";
import { getAuthMode, isSupabaseConfigured } from "@/supabase/config";
import { getSessionContext } from "@/supabase/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { ComingSoon } from "@/components/shared/coming-soon";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Configurações" };

const MODE_LABEL: Record<ReturnType<typeof getAuthMode>, string> = {
  supabase: "Supabase Auth",
  demo: "Modo demonstração (local)",
  unconfigured: "Não configurado",
};

const FUTURE_SECTIONS = [
  "Conta",
  "Membros da equipe",
  "Integrações",
  "Notificações",
  "Meta",
  "Outras plataformas",
];

export default async function SettingsPage() {
  const mode = getAuthMode();
  const session = mode === "supabase" ? await getSessionContext() : null;

  return (
    <ComingSoon
      title="Configurações"
      description="Estrutura preparada para receber as seções abaixo em fases futuras."
    >
      <ul className="mx-auto mt-5 grid max-w-sm gap-2 text-left text-sm">
        {FUTURE_SECTIONS.map((section) => (
          <li
            key={section}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-muted"
          >
            {section}
            <span className="text-xs">Em breve</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-muted">Autenticação:</span>
        <Badge tone={isSupabaseConfigured() ? "positive" : "muted"}>
          {MODE_LABEL[mode]}
        </Badge>
        {session?.profile && (
          <>
            <span className="text-muted">·</span>
            <span className="text-muted">Seu acesso:</span>
            <Badge tone="accent">{ROLE_LABEL[session.profile.role]}</Badge>
          </>
        )}
      </div>
    </ComingSoon>
  );
}
