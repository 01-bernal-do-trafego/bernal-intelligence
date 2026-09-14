import { createHash, randomBytes } from "node:crypto";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * Token opaco do link compartilhável: 256 bits de entropia (`crypto.randomBytes`,
 * CSPRNG do Node), codificado em base64url (sem `+`/`/`/`=`, seguro em URL).
 * 32 bytes -> exatamente 43 caracteres.
 *
 * Só o HASH SHA-256 (hex, 64 chars) é persistido em
 * `public.dashboard_share_links.token_hash` — o token em claro nunca é
 * gravado; é devolvido 1x ao admin na resposta da Server Action de
 * gerar/regenerar (ver app/(app)/clients/[id]/share-actions.ts) e descartado
 * depois disso.
 *
 * Sem `import "server-only"` de propósito (mesmo racional de
 * `lib/meta/oauth-config.ts`): módulo puro, sem segredo embutido nem leitura
 * de env — mantém testável direto. Só deve ser importado por código de
 * servidor (Server Actions / `server/*.ts`), nunca por um Client Component.
 */

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43; // base64url de 32 bytes, sem padding
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Gera um novo token opaco criptograficamente aleatório. */
export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex do token — a única forma persistida em banco. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Validação de formato barata, ANTES de qualquer consulta ao banco — rejeita
 * lixo óbvio (tamanho errado, caracteres fora do alfabeto base64url) sem
 * gastar uma query. Não é a autorização em si (isso é o hash bater no banco).
 */
export function isPlausibleShareToken(value: string): value is string {
  return value.length === TOKEN_LENGTH && TOKEN_RE.test(value);
}
