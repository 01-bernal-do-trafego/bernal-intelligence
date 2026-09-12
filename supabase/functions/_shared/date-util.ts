/**
 * DATA V2.3B — utilitários de data/timezone. Extraídos de `sync-core.ts`
 * (refactor MÍNIMO, comportamento IDÊNTICO — `sync-core.ts` passou a
 * importar daqui em vez de definir localmente; nenhuma lógica mudou, só o
 * lugar onde vive). Existem aqui para serem reutilizados por
 * `meta-backfill-discovery` (DATA V2.3B) sem duplicar a lógica de "qual é o
 * dia de hoje/o último dia fechado no timezone da conta" — a MESMA usada
 * pelo Current Sync desde a Auto Sync V1.
 */

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (base: string, n: number): string => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

/**
 * "Hoje" no timezone da conta (`timezoneName`, IANA — ex.: "America/Sao_Paulo").
 * `null`/inválido -> UTC. Nunca usa o timezone do processo/host.
 */
export function accountToday(timezoneName: string | null): string {
  const tz = timezoneName || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return isoDate(new Date());
  }
}
