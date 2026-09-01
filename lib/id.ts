/**
 * Geração de IDs internos. O ID de um cliente NÃO depende do nome da empresa
 * — é opaco e estável, e o usuário não precisa editá-lo pela interface.
 */
export function generateClientId(): string {
  const raw =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const token = raw.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  return `cli_${token}`;
}
