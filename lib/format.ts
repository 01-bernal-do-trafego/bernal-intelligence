/**
 * Formatação para exibição (pt-BR). Toda função é blindada contra
 * NaN / Infinity / undefined — a UI nunca deve mostrar esses valores.
 */

const LOCALE = "pt-BR";

const brl = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "BRL",
});

const brlWhole = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const compact = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function formatCurrency(value: number | null | undefined): string {
  return brl.format(finite(value));
}

export function formatCurrencyWhole(value: number | null | undefined): string {
  return brlWhole.format(finite(value));
}

export function formatCompactCurrency(value: number | null | undefined): string {
  return `R$ ${compact.format(finite(value))}`;
}

export function formatNumber(value: number | null | undefined): string {
  return integer.format(Math.round(finite(value)));
}

export function formatCompactNumber(value: number | null | undefined): string {
  return compact.format(finite(value));
}

export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  return `${finite(value).toLocaleString(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/** Variação percentual com sinal explícito. `null` -> travessão. */
export function formatSignedPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value, fractionDigits)}`;
}

/** ISO `YYYY-MM-DD` -> `DD/MM` (para eixos de gráfico). */
export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return day && month ? `${day}/${month}` : iso;
}

/** ISO `YYYY-MM-DD` -> `DD/MM/AAAA`. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return day && month && year ? `${day}/${month}/${year}` : iso;
}
