/**
 * Coerção segura de valores crus da Meta.
 * Regra: se a Meta não devolveu o valor, o resultado é `null` (ausência) —
 * nunca `0` inventado, nunca `NaN`/`Infinity`.
 */

export function parseMetaNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseMetaInt(value: unknown): number | null {
  const n = parseMetaNumber(value);
  return n === null ? null : Math.round(n);
}

/**
 * `date_start` de insights vem como `YYYY-MM-DD`; `created_time` etc. vêm como
 * `YYYY-MM-DDTHH:mm:ss-0700`. Extrai só a data (no fuso já aplicado pela Meta,
 * que devolve os insights no timezone da conta).
 */
export function metaTimeToISODate(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const datePart = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

/** `created_time`/`start_time` -> ISO completo (ou null). */
export function metaTimeToISO(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function ensureActPrefix(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

export function stripActPrefix(id: string): string {
  return id.startsWith("act_") ? id.slice(4) : id;
}

/** Só dígitos, opcionalmente com `act_` — evita usar nome como id. */
export function isValidMetaId(id: unknown): id is string {
  return typeof id === "string" && /^(act_)?\d{1,25}$/.test(id);
}
