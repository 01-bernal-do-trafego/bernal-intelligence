/**
 * META CONNECTION SECRET READ HARDENING — leitura segura de
 * `meta_connection_secrets`, compartilhada por todo leitor Deno.
 *
 * CAUSA RAIZ do bug real observado no Dev: `sync-core.ts` (e os demais
 * leitores) faziam `const { data: secret } = await admin.from(...).select(...)
 * .maybeSingle()` e DESCARTAVAM `error`. Qualquer falha transitória de
 * leitura (PostgREST/rede/DB) resultava em `data === null`, indistinguível
 * de "linha realmente não existe" — e era tratada como `no_connection_secret`,
 * levando à marcação incorreta de `reauthorization_required` numa conexão
 * saudável (confirmado no Dev: mesma conta alternando success/no_connection_secret
 * sem nenhuma mudança real de token).
 *
 * Este helper resolve a ambiguidade de uma vez, para todo leitor:
 *   - `not_found`  -> consulta teve SUCESSO e realmente não há linha.
 *   - `read_failed` -> a consulta FALHOU (error != null) — nunca vira
 *     `not_found`. Quem chama NÃO deve marcar `reauthorization_required`
 *     para este caso — é falha transitória/interna, não ausência de secret.
 *
 * Nunca retorna/loga cipher/iv/tag em caso de erro. Nunca expõe a mensagem
 * bruta do banco — só um `code` PostgREST/SQLSTATE seguro (padrão
 * alfanumérico de 5 chars, mesmo filtro já usado em `sync-core.ts` para
 * `acqErr.code`), quando disponível.
 */

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export interface ConnectionSecretRow {
  token_cipher: string;
  token_iv: string;
  token_tag: string;
}

export type ReadConnectionSecretResult =
  | { ok: true; secret: ConnectionSecretRow }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "read_failed"; code?: string };

/** Código SQLSTATE/PostgREST seguro para diagnóstico — nunca a mensagem bruta. */
function safeDbCode(error: unknown): string | undefined {
  const rawCode = (error as { code?: unknown } | null)?.code;
  return typeof rawCode === "string" && /^[0-9A-Za-z]{5}$/.test(rawCode) ? rawCode : undefined;
}

/**
 * Lê `token_cipher/token_iv/token_tag` de `meta_connection_secrets` para
 * `connectionId`. Distingue "não existe" (consulta ok, 0 linhas) de "falha
 * ao consultar" (error != null) — NUNCA trata a segunda como a primeira.
 */
export async function readConnectionSecret(
  admin: AnyClient,
  connectionId: string,
): Promise<ReadConnectionSecretResult> {
  const { data, error } = await admin
    .from("meta_connection_secrets")
    .select("token_cipher, token_iv, token_tag")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error) {
    const code = safeDbCode(error);
    return { ok: false, kind: "read_failed", ...(code ? { code } : {}) };
  }

  const secret = data as ConnectionSecretRow | null;
  if (!secret) return { ok: false, kind: "not_found" };

  return { ok: true, secret };
}
