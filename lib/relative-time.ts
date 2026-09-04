/**
 * Tempo relativo ("há 12 min", "há 3h") para timestamps ISO. Módulo PURO —
 * aceita `now` explícito para ser testável sem mockar `Date`.
 */
export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}
