/**
 * DATA V2.3A — Historical Backfill Rollout. Guarda DEV ONLY. Módulo PURO.
 *
 * Esta etapa só aceita o project-ref do Supabase Dev conhecido
 * (`vqodysgxdkkvmfqyprpu`, o mesmo linkado pela Supabase CLI durante toda a
 * DATA V2). Qualquer outro project-ref é recusado — em especial o de Prod,
 * checado por NOME explícito (não é "tudo que não é Dev é ok"; é "só Dev é
 * ok", e Prod tem uma mensagem própria mais clara).
 */

export const DEV_PROJECT_REF = "vqodysgxdkkvmfqyprpu";
/** Nunca aceitar — mesmo que apareça como "só mais um ref desconhecido". */
export const PROHIBITED_PROD_PROJECT_REF = "bmtzurlsohinqbjxcpje";

/** Extrai o project-ref de uma URL do Supabase (`https://<ref>.supabase.co/...`). `null` se não reconhecer o formato. */
export function extractProjectRef(url: string): string | null {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export class DevOnlyGuardError extends Error {}

/**
 * Lança `DevOnlyGuardError` se `url` não apontar para o project-ref de Dev
 * conhecido. Prod (`bmtzurlsohinqbjxcpje`) tem uma mensagem própria e mais
 * enfática; qualquer outro ref desconhecido também é recusado (esta etapa é
 * DEV ONLY — não "qualquer coisa que não seja Prod").
 */
export function assertDevProjectRef(url: string): void {
  const ref = extractProjectRef(url);
  if (ref === PROHIBITED_PROD_PROJECT_REF) {
    throw new DevOnlyGuardError(
      `ABORTADO: project-ref de PRODUÇÃO detectado (${ref}). Esta etapa (DATA V2.3A) é DEV ONLY — nunca rode o runner contra Prod.`,
    );
  }
  if (ref !== DEV_PROJECT_REF) {
    throw new DevOnlyGuardError(
      `ABORTADO: project-ref desconhecido (${ref ?? url}). Só ${DEV_PROJECT_REF} (Supabase Dev) é aceito nesta etapa.`,
    );
  }
}
