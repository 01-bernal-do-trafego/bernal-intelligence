/**
 * Offset UTC de um fuso da Meta. Módulo PURO.
 *
 * A conta de anúncio da Meta traz `timezone_name` (IANA, ex.:
 * "America/Sao_Paulo"). O offset numérico NÃO é persistido — ele varia com
 * horário de verão e nem sempre é inteiro (Ásia/Calcutá = +05:30,
 * Ásia/Katmandu = +05:45). Quando precisamos exibir o offset, derivamos aqui
 * a partir do nome do fuso e de um instante.
 */

/**
 * Rótulo do offset UTC do fuso `timeZone` no instante `at` (padrão: agora).
 * Ex.: "UTC−03:00", "UTC+05:30", "UTC±00:00". `null` se o fuso for inválido.
 */
export function utcOffsetLabel(
  timeZone: string,
  at: Date = new Date(),
): string | null {
  if (!timeZone) return null;
  let raw: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return null;
  }

  if (raw === "GMT" || raw === "UTC") return "UTC±00:00";
  const m = raw.match(/(?:GMT|UTC)([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return null;

  const sign = m[1] === "-" ? "−" : "+"; // U+2212 minus
  const hh = m[2].padStart(2, "0");
  const mm = (m[3] ?? "00").padStart(2, "0");
  if (hh === "00" && mm === "00") return "UTC±00:00";
  return `UTC${sign}${hh}:${mm}`;
}

/** Offset em minutos (assinado) do fuso no instante dado. `null` se inválido. */
export function utcOffsetMinutes(
  timeZone: string,
  at: Date = new Date(),
): number | null {
  const label = utcOffsetLabel(timeZone, at);
  if (!label) return null;
  if (label === "UTC±00:00") return 0;
  const m = label.match(/UTC([+−])(\d{2}):(\d{2})/);
  if (!m) return null;
  const total = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "−" ? -total : total;
}
