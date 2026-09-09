/**
 * Origem pública autoritativa do app. Módulo PURO.
 *
 * Atrás de um reverse proxy (ex.: Hostinger Business + Node), o processo Next
 * é bindado num endereço interno (`0.0.0.0:3000`), então `request.nextUrl.origin`
 * — derivado do bind pelo `next start` — aponta para esse endereço interno, não
 * para a URL pública. Redirects (`Location:`) montados a partir dele levam o
 * browser para `https://0.0.0.0:3000/...` (→ ERR_SSL_PROTOCOL_ERROR).
 *
 * `NEXT_PUBLIC_APP_URL` é a fonte autoritativa da origem pública. Sem ela, o
 * comportamento é o de desenvolvimento (origem do próprio request, que em
 * `next dev` local coincide com a URL pública).
 *
 * NÃO usamos `x-forwarded-host` como origem: um host encaminhado não é fonte
 * confiável de identidade num fluxo OAuth (risco de open-redirect se o proxy
 * não sanear o header). A origem tem que ser explícita.
 */

/** Normaliza uma string em `scheme://host[:porta]`, sem path/query/hash/barra. */
function normalizeOrigin(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/**
 * Origem pública configurada via `NEXT_PUBLIC_APP_URL` (sem barra final), ou
 * `""` quando a variável não está definida.
 */
export function configuredAppOrigin(): string {
  return normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL);
}

/** `true` quando há uma origem pública explícita configurada. */
export function hasConfiguredAppOrigin(): boolean {
  return configuredAppOrigin().length > 0;
}

/**
 * Origem autoritativa para montar redirects absolutos:
 * `NEXT_PUBLIC_APP_URL` quando configurada; senão, a origem do request (dev).
 */
export function appOrigin(request: { nextUrl: { origin: string } }): string {
  return configuredAppOrigin() || request.nextUrl.origin;
}
