import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePeriodParam } from "@/lib/meta/period";
import { resolveShareToken } from "@/server/share-link";
import { getClientRecord } from "@/server/clients";
import { getClientDashboard } from "@/server/client-dashboard";
import { runInShareContext } from "@/supabase/share-context";
import { DashboardContent } from "@/components/client-dashboard/dashboard-content";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Rota PÚBLICA (fora de `app/(app)` — sem `requireAgencySession()`, sem
 * `AppShell`/sidebar administrativa). A ÚNICA autorização é o token opaco
 * no path: `resolveShareToken` compara o hash contra
 * `public.dashboard_share_links` via `service_role` (não há sessão/RLS
 * possível aqui) e devolve o `client_id` que ele autoriza — NUNCA um valor
 * vindo do usuário. Token inválido/inexistente/desativado -> `notFound()`
 * -> `not-found.tsx` (mensagem neutra, nenhum detalhe interno).
 *
 * `runInShareContext` faz o RESTANTE do código (`getClientRecord`,
 * `getClientDashboard` e tudo que ele chama) funcionar SEM NENHUMA
 * alteração — é o MESMO query layer da página administrativa
 * (`app/(app)/clients/[id]/page.tsx`), só que lendo via `service_role` em
 * vez da sessão de cookies (ver `supabase/share-context.ts`).
 *
 * `force-dynamic`: sem isto, o Next poderia tentar renderizar/cachear esta
 * página estaticamente (nada aqui lê `cookies()`/`headers()`, que é o sinal
 * usual de rota dinâmica) — cada `/share/<token>` tem que resolver o token e
 * buscar dados FRESCOS a cada requisição.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    title: "Dashboard compartilhado",
    robots: { index: false, follow: false },
  };
}

interface SharePageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    period?: string;
    dateFrom?: string;
    dateTo?: string;
    compare?: string;
    account?: string;
    campaign?: string;
  }>;
}

export default async function SharePage({ params, searchParams }: SharePageProps) {
  const { token } = await params;
  const sp = await searchParams;

  const resolved = await resolveShareToken(token);
  if (!resolved) notFound();

  return runInShareContext(resolved.clientId, async () => {
    const client = await getClientRecord(resolved.clientId);
    if (!client) notFound();

    const compare = sp.compare === "1";
    const { preset, customRange } = resolvePeriodParam(sp.period, sp.dateFrom, sp.dateTo);
    const dashboard = await getClientDashboard({
      client,
      preset,
      customRange,
      compare,
      accountId: sp.account,
      campaignId: sp.campaign,
    });

    return (
      <div className="min-h-full bg-background">
        <header className="border-b border-border px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <span className="size-2.5 rounded-full bg-accent" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Bernal Intelligence
            </span>
          </div>
          <div className="mx-auto mt-2 max-w-7xl">
            <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
            <p className="text-sm text-muted">Dashboard de desempenho</p>
          </div>
        </header>

        <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-8">
          <DashboardContent
            clientId={client.id}
            dashboard={dashboard}
            compare={compare}
            readOnly
          />
        </main>
      </div>
    );
  });
}
