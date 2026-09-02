import type { ClientStatus } from "./domain";

export type { ClientStatus };

/**
 * Registro REAL de cliente, espelho de `public.clients` no Supabase.
 * Contém apenas identidade/gestão — nenhum campo de métrica ou performance
 * (esses continuam mockados via lib/mock/demo-performance até a Meta Ads).
 */
export interface ClientRecord {
  /** UUID gerado pelo banco. Nunca derivado do nome. */
  id: string;
  name: string;
  internalName: string | null;
  logoUrl: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}
