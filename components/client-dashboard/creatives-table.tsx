"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Image as ImageIcon, Video } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { CreativeValidationRow } from "@/server/meta-creatives-data";

type SortKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "results"
  | "cost_per_result";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Investimento" },
  { key: "results", label: "Resultados" },
  { key: "cost_per_result", label: "Custo por resultado" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "clicks", label: "Cliques" },
  { key: "impressions", label: "Impressões" },
];

const FORMAT_LABEL: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  dynamic: "Dinâmico",
  unknown: "—",
};

const ATTR_BADGE: Record<
  CreativeValidationRow["attribution"],
  { label: string; tone: "positive" | "warning" | "muted" }
> = {
  complete: { label: "Atribuição observada", tone: "positive" },
  partial: { label: "Atribuição parcial", tone: "warning" },
  unconfirmed: { label: "Histórico não confirmado", tone: "muted" },
};

function num(v: number | null, fmt: (n: number) => string) {
  return v == null ? <span className="text-muted">—</span> : <span className="tabular-nums">{fmt(v)}</span>;
}

function money(v: number | null, currency: string | null) {
  if (v == null) return <span className="text-muted">—</span>;
  try {
    return (
      <span className="tabular-nums">
        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(v)}
      </span>
    );
  } catch {
    return <span className="tabular-nums">{formatCurrency(v)}</span>;
  }
}

function Preview({ row }: { row: CreativeValidationRow }) {
  const src = row.thumbnailUrl ?? row.imageUrl;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={row.name ?? row.creativeId}
        className="size-12 shrink-0 rounded-md border border-border object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-surface-elevated text-muted">
      {row.hasVideo ? <Video className="size-5" /> : <ImageIcon className="size-5" />}
    </div>
  );
}

interface CreativesTableProps {
  rows: CreativeValidationRow[];
  currency: string | null;
  resultLabel: string;
  costLabel: string;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onToggle: (k: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "-mr-1 ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted",
      )}
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}

export function CreativesTable({ rows, currency, resultLabel, costLabel }: CreativesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "spend",
    dir: "desc",
  });

  function toggleSort(key: SortKey) {
    setSort((p) =>
      p.key === key ? { key, dir: p.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" },
    );
  }

  const sorted = useMemo(() => {
    const factor = sort.dir === "asc" ? 1 : -1;
    const val = (r: CreativeValidationRow) => {
      const m = r.metrics as Record<string, number | null>;
      return m[sort.key] ?? Number.NEGATIVE_INFINITY;
    };
    return [...rows].sort((a, b) => (val(a) - val(b)) * factor);
  }, [rows, sort]);

  const columns: Column<CreativeValidationRow>[] = [
    {
      key: "creative",
      header: "Criativo",
      render: (r) => (
        <div className="flex items-start gap-3">
          <Preview row={r} />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {r.name ?? r.adNames[0] ?? r.creativeId}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className="font-mono">creative {r.creativeId}</span>
              <span aria-hidden>·</span>
              <span>
                {r.adIds.length} anúncio{r.adIds.length === 1 ? "" : "s"}
              </span>
              {r.campaignNames[0] && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{r.campaignNames[0]}</span>
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="muted">{FORMAT_LABEL[r.format] ?? r.format}</Badge>
              {r.variantSummary && <Badge tone="muted">{r.variantSummary}</Badge>}
              {r.callToActionType && <Badge tone="muted">{r.callToActionType}</Badge>}
            </div>
            {(r.title || r.body) && (
              <p className="mt-1 line-clamp-2 max-w-md text-xs text-muted">
                {r.title ? <span className="text-foreground">{r.title}</span> : null}
                {r.title && r.body ? " — " : null}
                {r.body}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "attribution",
      header: "Atribuição",
      render: (r) => {
        const b = ATTR_BADGE[r.attribution];
        return (
          <div className="flex flex-col gap-1">
            <Badge tone={b.tone}>{b.label}</Badge>
            {r.attribution !== "unconfirmed" && r.excluded.days > 0 && (
              <span className="text-[11px] text-muted">
                {money(r.excluded.spend, currency)} fora · {r.excluded.ads} anúncio(s) ·{" "}
                {r.excluded.days} dia(s)
              </span>
            )}
            {r.attribution === "unconfirmed" && (
              <span className="text-[11px] text-muted">
                Histórico ainda não atribuível com segurança.
              </span>
            )}
          </div>
        );
      },
    },
    metricCol("spend", "Investimento", (r) => money(r.metrics.spend, currency)),
    metricCol("impressions", "Impressões", (r) => num(r.metrics.impressions, formatNumber)),
    metricCol("clicks", "Cliques", (r) => num(r.metrics.clicks, formatNumber)),
    metricCol("ctr", "CTR", (r) => num(r.metrics.ctr, (n) => formatPercent(n, 2))),
    metricCol("cpc", "CPC", (r) => money(r.metrics.cpc, currency)),
    metricCol("cpm", "CPM", (r) => money(r.metrics.cpm, currency)),
    metricCol("results", resultLabel, (r) => num(r.metrics.results, formatNumber)),
    metricCol("cost_per_result", costLabel, (r) => money(r.metrics.cost_per_result, currency)),
  ];

  function metricCol(
    key: SortKey,
    label: string,
    render: (r: CreativeValidationRow) => ReactNode,
  ): Column<CreativeValidationRow> {
    return {
      key,
      align: "right",
      header: (
        <SortHeader
          label={label}
          sortKey={key}
          activeKey={sort.key}
          dir={sort.dir}
          onToggle={toggleSort}
        />
      ),
      render,
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Ordenar por:</span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => toggleSort(o.key)}
            className={cn(
              "rounded-md border px-2 py-1 font-medium transition-colors",
              sort.key === o.key
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border text-muted hover:text-foreground",
            )}
          >
            {o.label}
            {sort.key === o.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={sorted}
        getRowId={(r) => r.creativeId}
        emptyMessage="Nenhum criativo sincronizado para este escopo."
      />
    </div>
  );
}
