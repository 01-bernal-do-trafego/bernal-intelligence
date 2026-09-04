/**
 * Rótulos amigáveis (singular, para célula de tabela por cliente) dos estados
 * de `meta_client_sync_health`. Módulo PURO.
 *
 * Não reaproveita os rótulos de `components/client-dashboard/sync-health-lines.tsx`
 * de propósito: aquele componente já publicado usa formas no PLURAL para uma
 * linha de resumo de 1 cliente ("Dados de performance: Atualizados"); aqui
 * cada linha da tabela é 1 cliente, então o singular é o correto
 * ("Atualizado"). São contextos de cópia diferentes, não a mesma fonte.
 */
import type { PerformanceStatus, CreativesStatus } from "@/lib/meta/sync-health";
import type { BadgeTone } from "@/components/ui/badge";

export const PERFORMANCE_STATUS_LABEL: Record<PerformanceStatus, string> = {
  fresh: "Atualizado",
  stale: "Atrasado",
  never: "Nunca sincronizado",
};

export const PERFORMANCE_STATUS_TONE: Record<PerformanceStatus, BadgeTone> = {
  fresh: "positive",
  stale: "warning",
  never: "muted",
};

export const CREATIVES_STATUS_LABEL: Record<CreativesStatus, string> = {
  ok: "OK",
  partial: "Parcial",
  failed: "Falha",
  unknown: "—",
};

export const CREATIVES_STATUS_TONE: Record<CreativesStatus, BadgeTone> = {
  ok: "positive",
  partial: "warning",
  failed: "negative",
  unknown: "muted",
};
