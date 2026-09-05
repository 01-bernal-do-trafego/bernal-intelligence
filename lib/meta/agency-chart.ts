/**
 * Helpers PUROS do gráfico "Investimento por cliente" (Agency Overview) —
 * fora do componente para serem testáveis sem carregar Recharts.
 */

/**
 * Altura dinâmica da barra horizontal em px:
 *   1 cliente  -> 170 (não estica)
 *   2..~6      -> cresce ~40px por cliente
 *   >= ~7      -> teto de 400
 */
export function topClientsChartHeight(count: number): number {
  if (count <= 1) return 170;
  return Math.min(400, 130 + count * 40);
}

/** Trunca visualmente o nome do cliente (o nome completo vai no tooltip). */
export function truncateClientName(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
