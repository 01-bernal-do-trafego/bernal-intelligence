import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { formatDecimal, formatNumber, formatPercent } from "@/lib/format";
import { getClientRecord } from "@/server/clients";
import { getMetaConnection } from "@/server/meta-connection";
import {
  getMetaValidationOverview,
  type MetaValidationCampaignRow,
} from "@/server/meta-sync-data";
import { MetaConnectionBadge } from "@/components/shared/status-badges";
import { SyncMetaButton } from "@/components/clients/sync-meta-button";

export const metadata: Metadata = { title: "Validar sincronização" };

interface PageProps {
  params: Promise<{ id: string }>;
}

function money(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(value);
  } catch {
    return value.toLocaleString("pt-BR");
  }
}
const dash = (v: number | null, fmt: (n: number) => string) =>
  v === null ? "—" : fmt(v);

function dt(value: string | null): string {
  if (!value) return "—";
  const t = Date.parse(value);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

export default async function MetaDataPage({ params }: PageProps) {
  const { id } = await params;
  const client = await getClientRecord(id);
  if (!client) notFound();

  const [connection, overview] = await Promise.all([
    getMetaConnection(client.id),
    getMetaValidationOverview(client.id),
  ]);

  const { account, lastRun, period, totals, counts, campaigns } = overview;
  const currency = account?.currency ?? null;

  const totalCards: Array<{ label: string; value: string }> = [
    { label: "Investimento", value: money(totals.spend, currency) },
    { label: "Impressões", value: dash(totals.impressions, formatNumber) },
    { label: "Alcance", value: dash(totals.reach, formatNumber) },
    { label: "Frequência", value: dash(totals.frequency, (n) => formatDecimal(n, 2)) },
    { label: "Cliques", value: dash(totals.clicks, formatNumber) },
    { label: "CTR", value: dash(totals.ctr, (n) => formatPercent(n, 2)) },
    { label: "CPC", value: money(totals.cpc, currency) },
    { label: "CPM", value: money(totals.cpm, currency) },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href={`/clients/${client.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {client.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            Validar sincronização
          </h1>
          <MetaConnectionBadge state={connection.state} />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          Área de <span className="text-foreground">administração</span>: dados
          reais sincronizados da Meta, para conferir manualmente contra o Ads
          Manager <span className="text-foreground">antes</span> de substituir os
          cards do dashboard. Nada aqui altera o dashboard do cliente.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Conta" value={account?.name ?? account?.adAccountId ?? "—"} sub={account?.adAccountId} />
        <Field
          label="Período (últimos 30 dias)"
          value={period.dateFrom && period.dateTo ? `${period.dateFrom} → ${period.dateTo}` : "—"}
        />
        <Field
          label="Última sincronização"
          value={dt(account?.lastSyncAt ?? lastRun?.finishedAt ?? null)}
          sub={
            lastRun?.status
              ? `${lastRun.status}${lastRun.errorText ? ` · ${lastRun.errorText}` : ""}`
              : undefined
          }
        />
      </div>

      <div>
        <SyncMetaButton clientId={client.id} />
      </div>

      {!overview.hasData ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          Nenhum dado sincronizado ainda. Clique em{" "}
          <span className="text-foreground">Sincronizar Meta</span> para trazer os
          últimos 30 dias.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Totais do período
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {totalCards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <div className="text-xs text-muted">{c.label}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
            {totals.reach !== null &&
              totals.frequency !== null &&
              totals.frequencyComputed !== null &&
              Math.abs(totals.frequency - totals.frequencyComputed) > 0.05 && (
                <p className="text-xs text-warning">
                  Frequência da Meta ({formatDecimal(totals.frequency, 2)}) difere
                  de impressões/alcance ({formatDecimal(totals.frequencyComputed, 2)}).
                </p>
              )}
            <div className="flex flex-wrap gap-4 text-sm text-muted">
              <span>
                Campanhas:{" "}
                <span className="text-foreground">{counts.campaigns}</span>
              </span>
              <span>
                Conjuntos: <span className="text-foreground">{counts.adsets}</span>
              </span>
              <span>
                Anúncios: <span className="text-foreground">{counts.ads}</span>
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Campanhas (dados reais)
            </h2>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhuma campanha com dados no período.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-elevated text-left text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2">Campanha</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Investimento</th>
                      <th className="px-3 py-2 text-right">Impressões</th>
                      <th className="px-3 py-2 text-right">Alcance</th>
                      <th className="px-3 py-2 text-right">Cliques</th>
                      <th className="px-3 py-2 text-right">CTR</th>
                      <th className="px-3 py-2 text-right">CPC</th>
                      <th className="px-3 py-2 text-right">CPM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {campaigns.map((c: MetaValidationCampaignRow) => (
                      <tr key={c.campaignId}>
                        <td className="px-3 py-2 text-foreground">
                          {c.name ?? c.campaignId}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {c.effectiveStatus ?? c.status ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(c.spend, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {dash(c.impressions, formatNumber)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {dash(c.reach, formatNumber)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {dash(c.clicks, formatNumber)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {dash(c.ctr, (n) => formatPercent(n, 2))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(c.cpc, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(c.cpm, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
