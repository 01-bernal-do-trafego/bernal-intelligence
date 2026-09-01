import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./skeleton";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: readonly Column<T>[];
  data: readonly T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  skeletonRows?: number;
  className?: string;
}

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  loading = false,
  error = null,
  emptyMessage = "Nenhum registro encontrado.",
  skeletonRows = 5,
  className,
}: DataTableProps<T>) {
  const colCount = columns.length;

  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-xl border border-border bg-surface",
        className,
      )}
    >
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted",
                  ALIGN[col.align ?? "left"],
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border/60 last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <Skeleton className="h-4 w-full max-w-[120px]" />
                  </td>
                ))}
              </tr>
            ))
          ) : error ? (
            <tr>
              <td
                colSpan={colCount}
                className="px-4 py-10 text-center text-sm text-negative"
              >
                {error}
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={colCount}
                className="px-4 py-10 text-center text-sm text-muted"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/60 transition-colors last:border-0",
                  onRowClick && "cursor-pointer hover:bg-surface-elevated",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-foreground",
                      ALIGN[col.align ?? "left"],
                      col.className,
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
