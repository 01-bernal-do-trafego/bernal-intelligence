/**
 * Cifra AES-256-GCM do token da Meta (Edge Function / Deno).
 *
 * `META_TOKEN_ENC_KEY` = 32 bytes em base64 (chave AES-256). Vive só nos
 * secrets da função. O token em claro só existe na memória da função durante a
 * troca; o que persiste em `meta_connection_secrets` são os 3 campos abaixo.
 */

export interface SealedToken {
  /** ciphertext sem o tag, base64 */
  cipherB64: string;
  /** IV de 12 bytes, base64 */
  ivB64: string;
  /** tag GCM de 16 bytes, base64 */
  tagB64: string;
}

export function base64ToBytes(b64: string): Uint8Array {
  // Tolera espaços/quebras e o alfabeto url-safe; a validação real é o
  // tamanho de 32 bytes exigido em importKey().
  const normalized = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function importKey(encKeyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(encKeyB64);
  if (raw.byteLength !== 32) {
    throw new Error(
      `META_TOKEN_ENC_KEY deve ter 32 bytes (AES-256); recebeu ${raw.byteLength}.`,
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
}

/** Cifra o token e devolve cipher / iv / tag separados, em base64. */
export async function sealToken(
  plaintext: string,
  encKeyB64: string,
): Promise<SealedToken> {
  const key = await importKey(encKeyB64);
  // IV de 96 bits, aleatório e NOVO a cada chamada (nunca reutilizado com a
  // mesma chave). Persistido junto do ciphertext em meta_connection_secrets.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  // WebCrypto AES-GCM: saída = ciphertext || tag(16 bytes / 128 bits)
  const tag = sealed.slice(sealed.length - 16);
  const cipher = sealed.slice(0, sealed.length - 16);
  return {
    cipherB64: bytesToBase64(cipher),
    ivB64: bytesToBase64(iv),
    tagB64: bytesToBase64(tag),
  };
}
