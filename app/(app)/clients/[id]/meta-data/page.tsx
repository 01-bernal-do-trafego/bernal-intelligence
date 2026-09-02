import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { formatDecimal, formatNumber, formatPercent } from "@/lib/format";
import { periodLabel } from "@/lib/date-range";
import { metaAttributionLabel } from "@/lib/meta/config";
import { getClientRecord } from "@/server/clients";
import { getMetaConnection } from "@/server/meta-connection";
import {
  getMetaValidationOverview,
  type MetaValidationCampaignRow,
} from "@/server/meta-sync-data";
import { MetaConnectionBadge } from "@/components/shared/status-badges";
import { SyncMetaButton } from "@/components/clients/sync-meta-button";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export const metadata: Metadata = { title: "Validar sincronização" };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}

const CONV_LABEL: Record<string, string> = {
  results: "Resultados",
  cost_per_result: "Custo por resultado",
  leads: "Leads",
  cpl: "CPL",
  conversations: "Conversas",
  cost_per_conversation: "Custo por conversa",
  purchases: "Compras",
  cpa: "CPA",
  revenue: "Receita",
  roas: "ROAS",
};

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

function fmtConv(
  id: string,
  v: number | null,
  currency: string | null,
): string {
  if (v === null) return "—";
  if (id === "roas") return formatDecimal(v, 2);
  if (["revenue", "cpl", "cpa", "cost_per_conversation", "cost_per_result"].includes(id))
    return money(v, currency);
  return formatNumber(v);
}

function dt(value: string | null): string {
  if (!value) return "—";
  const t = Date.parse(value);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

export default async function MetaDataPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClientRecord(id);
  if (!client) notFound();

  const [connection, overview] = await Promise.all([
    getMetaConnection(client.id),
    getMetaValidationOverview(client.id, sp.period),
  ]);

  const {
    account,
    lastRun,
    period,
    totals,
    counts,
    campaigns,
    events,
    conversionRows,
    resultMetric,
    relevantConversionColumns,
    attributionWindow,
  } = overview;
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

  const mappedEvents = events.filter((e) => e.status === "mapped");
  const unmappedEvents = events.filter((e) => e.status === "unmapped");

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
          Manager <span className="text-foreground">antes</span> de liberar no
          dashboard do cliente. Nada aqui altera o dashboard.
        </p>
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <DateRangePicker />
      </Suspense>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Conta" value={account?.name ?? account?.adAccountId ?? "—"} sub={account?.adAccountId} />
        <Field
          label={`Período · ${periodLabel(overview.preset)}`}
          value={period.dateFrom && period.dateTo ? `${period.dateFrom} → ${period.dateTo}` : "—"}
        />
        <Field
          label="Atribuição"
          value={metaAttributionLabel(attributionWindow)}
          sub={
            attributionWindow === "unified_attribution"
              ? "config. dos conjuntos de anúncios (não forçamos janela)"
              : (attributionWindow ?? undefined)
          }
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
          Nenhum dado sincronizado para este período. Clique em{" "}
          <span className="text-foreground">Sincronizar Meta</span>.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Totais do período (métricas base)
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
            <div className="flex flex-wrap gap-4 text-sm text-muted">
              <span>
                Campanhas: <span className="text-foreground">{counts.campaigns}</span>
              </span>
              <span>
                Conjuntos: <span className="text-foreground">{counts.adsets}</span>
              </span>
              <span>
                Anúncios: <span className="text-foreground">{counts.ads}</span>
              </span>
            </div>
          </section>

          {/* ---- Resultado principal configurado ---- */}
          {resultMetric && (
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Resultado principal do cliente
              </h2>
              <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <p className="text-muted">
                  Configurado: <span className="text-foreground">{resultMetric.label}</span>{" "}
                  (<span className="font-mono text-xs">{resultMetric.type}</span>)
                </p>
                {resultMetric.available ? (
                  <p className="mt-1 text-foreground">
                    {resultMetric.label}: <b className="tabular-nums">{formatNumber(resultMetric.value)}</b>{" "}
                    · {resultMetric.costLabel}:{" "}
                    <b className="tabular-nums">{money(resultMetric.costPerResult, currency)}</b>
                    {resultMetric.source && (
                      <span className="ml-2 font-mono text-xs text-muted">
                        fonte: {resultMetric.source}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-warning">
                    Métrica não disponível neste período/conta — o evento
                    configurado não veio na resposta da Meta. Nenhuma outra
                    métrica é usada no lugar.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ---- Métricas de conversão (validação) ---- */}
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Métricas de conversão (validação)
            </h2>
            <p className="text-xs text-muted">
              Compare manualmente com o Ads Manager no mesmo período. Só entram
              nos cards/gráficos do dashboard após sua aprovação.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-elevated text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Métrica</th>
                    <th className="px-3 py-2 text-right">Valor Bernal</th>
                    <th className="px-3 py-2">Fonte / mapeamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {conversionRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-foreground">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtConv(r.id, r.value, currency)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {r.value === null ? "sem fonte" : (r.source ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---- Eventos e conversões ---- */}
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Eventos e conversões
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted">
                A Meta não retornou eventos de conversão para este período/conta.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-elevated text-left text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2">Action type (Meta)</th>
                        <th className="px-3 py-2">Métrica Bernal</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                        <th className="px-3 py-2 text-right">Valor de conversão</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...mappedEvents, ...unmappedEvents].map((e) => (
                        <tr key={e.actionType}>
                          <td className="px-3 py-2 font-mono text-xs text-foreground">
                            {e.actionType}
                          </td>
                          <td className="px-3 py-2 text-muted">
                            {e.bernalMetric
                              ? CONV_LABEL[e.bernalMetric] ?? e.bernalMetric
                              : e.bernalValueMetric
                                ? CONV_LABEL[e.bernalValueMetric] ?? e.bernalValueMetric
                                : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {e.count === null ? "—" : formatNumber(e.count)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {e.value === null ? "—" : money(e.value, currency)}
                          </td>
                          <td className="px-3 py-2">
                            {e.status === "mapped" ? (
                              <span className="text-positive">Mapeado</span>
                            ) : (
                              <span className="text-warning">Requer revisão</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {unmappedEvents.length > 0 && (
                  <p className="text-xs text-warning">
                    {unmappedEvents.length} evento(s) ainda não mapeado(s) — os
                    valores foram preservados em `raw_actions`; o Metric Registry
                    pode ser ampliado depois sem re-sincronizar.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---- Campanhas (base + conversões relevantes) ---- */}
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
                <table className="w-full whitespace-nowrap text-sm">
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
                      {relevantConversionColumns.map((id) => (
                        <th key={id} className="px-3 py-2 text-right">
                          {CONV_LABEL[id] ?? id}
                        </th>
                      ))}
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
                        {relevantConversionColumns.map((cid) => (
                          <td key={cid} className="px-3 py-2 text-right tabular-nums">
                            {fmtConv(cid, c.conversions[cid] ?? null, currency)}
                          </td>
                        ))}
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
