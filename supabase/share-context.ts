import { AsyncLocalStorage } from "node:async_hooks";

/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 *
 * O dashboard compartilhável (`/share/<token>`) não tem sessão de usuário —
 * não existe `auth.uid()` para a RLS avaliar. Para reaproveitar 100% do
 * query layer existente (`getClientDashboard` e tudo que ele chama, todos
 * escritos contra `createSupabaseServerClient()`) SEM duplicar nenhuma
 * consulta, este módulo dá ao restante do código um "contexto ambiente":
 * enquanto uma renderização roda dentro de `runInShareContext`,
 * `supabase/server.ts#createSupabaseServerClient` devolve o client
 * `service_role` (ver `supabase/service.ts`) em vez do client de cookies.
 *
 * Segurança: `runInShareContext` só é chamado DEPOIS que o token já foi
 * validado (hash bate em `dashboard_share_links`, `is_active = true`) e
 * SEMPRE com o `clientId` resolvido do banco — nunca com um valor vindo do
 * usuário/URL. O `clientId` do contexto existe para auditoria/depuração;
 * nenhuma função do query layer precisa lê-lo (cada uma já recebe o
 * `clientId` explicitamente como argumento, como sempre foi).
 *
 * `AsyncLocalStorage` propaga por toda a cadeia de `await` disparada
 * SINCRONAMENTE dentro do callback de `.run(...)` — é o mecanismo padrão do
 * Node para contexto por-requisição (o próprio Next o usa internamente).
 *
 * Sem `import "server-only"` de propósito (mesmo racional de
 * `lib/meta/oauth-config.ts`/`lib/share-token.ts`): módulo puro (só
 * `node:async_hooks`), sem segredo embutido — mantém testável direto (ver
 * tests/share/share-context.test.ts, que prova a ISOLAÇÃO real entre
 * contextos concorrentes). Só deve ser importado por código de servidor.
 */

interface ShareStore {
  clientId: string;
}

const shareContextStorage = new AsyncLocalStorage<ShareStore>();

/** Executa `fn` com o contexto de share ativo para `clientId`. */
export function runInShareContext<T>(
  clientId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return shareContextStorage.run({ clientId }, fn);
}

/** `true` quando a execução atual está dentro de `runInShareContext`. */
export function isInShareContext(): boolean {
  return shareContextStorage.getStore() !== undefined;
}

/** clientId do contexto de share atual, ou `null` fora dele. */
export function getShareContextClientId(): string | null {
  return shareContextStorage.getStore()?.clientId ?? null;
}
