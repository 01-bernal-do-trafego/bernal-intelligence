/**
 * DATA V2.3A/V2.3B + PROD SAFETY — Guarda de ambiente do runner de backfill.
 * Módulo PURO (nenhuma rede, nenhum I/O).
 *
 * Substitui o guard anterior de UM ambiente só (`dev-guard.ts`, DEV ONLY) por
 * um guard de DOIS ambientes conhecidos — a proteção não fica mais fraca:
 * Prod continua nunca aceito por acidente, e passa a ter uma segunda barreira
 * (confirmação explícita) que o DEV nunca precisou ter.
 *
 * Só 2 project-refs existem nesta arquitetura — nunca "qualquer ref
 * desconhecido é aceito":
 *   dev  -> vqodysgxdkkvmfqyprpu (comportamento padrão — SEM confirmação extra)
 *   prod -> bmtzurlsohinqbjxcpje (exige `--environment prod` E
 *           `--confirm-project-ref bmtzurlsohinqbjxcpje` — as DUAS sempre,
 *           nunca uma no lugar da outra)
 *
 * DUAS checagens INDEPENDENTES, ambas obrigatórias para prod:
 *   1. `assertEnvironmentConfirmed` — a INTENÇÃO do operador (flags), antes
 *      de sequer ler variável de ambiente ou tocar numa URL.
 *   2. `assertUrlMatchesEnvironment` — cada URL de Edge Function (chamada 1x
 *      por URL, mesmo padrão do guard anterior) realmente aponta para o
 *      project-ref do ambiente declarado. Cobre "misturar Dev e Prod" porque
 *      cada URL é validada contra o MESMO ambiente declarado — uma URL de
 *      Prod com `--environment dev` (ou vice-versa) nunca passa.
 */

export const DEV_PROJECT_REF = "vqodysgxdkkvmfqyprpu";
export const PROD_PROJECT_REF = "bmtzurlsohinqbjxcpje";

export type Environment = "dev" | "prod";

export const KNOWN_ENVIRONMENTS: readonly Environment[] = ["dev", "prod"];

const PROJECT_REF_BY_ENVIRONMENT: Readonly<Record<Environment, string>> = {
  dev: DEV_PROJECT_REF,
  prod: PROD_PROJECT_REF,
};

export class EnvironmentGuardError extends Error {}

/** Extrai o project-ref de uma URL do Supabase (`https://<ref>.supabase.co/...`). `null` se não reconhecer o formato. */
export function extractProjectRef(url: string): string | null {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * PASSO 1 da dupla confirmação de Prod — a INTENÇÃO do operador.
 *
 * `dev` (padrão, sem `--environment`): passa direto, nenhuma confirmação
 * extra — comportamento idêntico ao guard anterior.
 *
 * `prod`: só passa se `--confirm-project-ref` foi passado E é IGUAL,
 * caractere por caractere, ao project-ref de Prod. `--environment prod`
 * sozinho NUNCA basta — é a proteção central contra "apontar pra prod sem
 * querer" (typo em `--environment`, script/alias reaproveitado, etc.).
 */
export function assertEnvironmentConfirmed(
  environment: Environment,
  confirmProjectRef: string | null,
): void {
  if (environment === "dev") return;
  if (confirmProjectRef === PROD_PROJECT_REF) return;
  throw new EnvironmentGuardError(
    confirmProjectRef
      ? `ABORTADO: --confirm-project-ref "${confirmProjectRef}" não confere com o project-ref de PRODUÇÃO (${PROD_PROJECT_REF}). --environment prod exige a confirmação EXATA.`
      : `ABORTADO: --environment prod exige --confirm-project-ref ${PROD_PROJECT_REF} (confirmação explícita — sem valor padrão, sem inferência).`,
  );
}

/**
 * PASSO 2 da dupla confirmação — cada URL de Edge Function (orchestrator,
 * executor, e discovery quando `--all-history`) precisa apontar para o
 * project-ref do ambiente DECLARADO em `--environment`. Chamada 1x por URL,
 * sempre antes de usar aquela URL para qualquer chamada de rede.
 *
 * Cobre, todos com mensagem própria:
 *   - URL de Prod com `--environment dev` (o guard antigo já cobria isto);
 *   - URL de Dev com `--environment prod` (novo — protege o sentido oposto);
 *   - qualquer terceiro project-ref desconhecido (nunca "aceita por padrão");
 *   - URL que não bate nem o formato `https://<ref>.supabase.co`.
 */
export function assertUrlMatchesEnvironment(url: string, environment: Environment): void {
  const expected = PROJECT_REF_BY_ENVIRONMENT[environment];
  const ref = extractProjectRef(url);

  if (ref === expected) return;

  if (ref === PROD_PROJECT_REF) {
    throw new EnvironmentGuardError(
      `ABORTADO: URL de PRODUÇÃO (${PROD_PROJECT_REF}) detectada com --environment ${environment}. Esperado: ${expected}. URLs de dev/prod não podem se misturar.`,
    );
  }
  if (ref === DEV_PROJECT_REF) {
    throw new EnvironmentGuardError(
      `ABORTADO: URL de DEV (${DEV_PROJECT_REF}) detectada com --environment ${environment}. Esperado: ${expected}. URLs de dev/prod não podem se misturar.`,
    );
  }
  throw new EnvironmentGuardError(
    `ABORTADO: project-ref desconhecido ("${ref ?? url}"). Só ${DEV_PROJECT_REF} (dev) e ${PROD_PROJECT_REF} (prod) são aceitos nesta arquitetura.`,
  );
}
