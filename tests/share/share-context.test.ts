/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 * Teste REAL de supabase/share-context.ts — módulo puro (AsyncLocalStorage),
 * sem "server-only" de propósito (ver comentário no arquivo).
 *
 * Prova a propriedade que sustenta toda a arquitetura de leitura do dashboard
 * compartilhável: dois `runInShareContext` CONCORRENTES nunca vazam o
 * clientId um para o outro, mesmo com `await`s intercalados no meio.
 */
import { describe, expect, it } from "vitest";
import {
  getShareContextClientId,
  isInShareContext,
  runInShareContext,
} from "@/supabase/share-context";

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("fora de qualquer contexto", () => {
  it("isInShareContext() é false; getShareContextClientId() é null", () => {
    expect(isInShareContext()).toBe(false);
    expect(getShareContextClientId()).toBeNull();
  });
});

describe("dentro de runInShareContext", () => {
  it("isInShareContext() vira true e getShareContextClientId() devolve o clientId passado", async () => {
    const seen = await runInShareContext("client-a", async () => {
      return { inside: isInShareContext(), id: getShareContextClientId() };
    });
    expect(seen.inside).toBe(true);
    expect(seen.id).toBe("client-a");
  });

  it("propaga através de vários `await`s dentro do callback", async () => {
    const id = await runInShareContext("client-b", async () => {
      await tick(5);
      await tick(1);
      return getShareContextClientId();
    });
    expect(id).toBe("client-b");
  });

  it("volta a ser null/false DEPOIS que o contexto termina", async () => {
    await runInShareContext("client-c", async () => {
      /* noop */
    });
    expect(isInShareContext()).toBe(false);
    expect(getShareContextClientId()).toBeNull();
  });

  it("o valor de retorno do callback é propagado normalmente", async () => {
    const result = await runInShareContext("client-d", async () => 42);
    expect(result).toBe(42);
  });

  it("uma exceção dentro do callback rejeita a promise de runInShareContext (ex.: notFound())", async () => {
    await expect(
      runInShareContext("client-e", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("isolamento entre contextos CONCORRENTES — dois clients nunca se misturam", () => {
  it("Promise.all de dois runInShareContext intercalados nunca vaza o clientId um para o outro", async () => {
    const [a, b] = await Promise.all([
      runInShareContext("client-A", async () => {
        await tick(10);
        return getShareContextClientId();
      }),
      runInShareContext("client-B", async () => {
        await tick(1);
        return getShareContextClientId();
      }),
    ]);
    expect(a).toBe("client-A");
    expect(b).toBe("client-B");
  });

  it("10 contextos concorrentes, cada um só vê o próprio clientId do início ao fim", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `client-${i}`);
    const results = await Promise.all(
      ids.map((id) =>
        runInShareContext(id, async () => {
          await tick(Math.random() * 10);
          const mid = getShareContextClientId();
          await tick(Math.random() * 10);
          const end = getShareContextClientId();
          return { mid, end };
        }),
      ),
    );
    results.forEach((r, i) => {
      expect(r.mid).toBe(ids[i]);
      expect(r.end).toBe(ids[i]);
    });
  });

  it("contexto aninhado (share dentro de share, caso hipotético) — o interno vence só durante sua própria execução, o externo volta depois", async () => {
    const seenDuring: (string | null)[] = [];
    const outer = await runInShareContext("outer", async () => {
      seenDuring.push(getShareContextClientId());
      const inner = await runInShareContext("inner", async () => {
        seenDuring.push(getShareContextClientId());
        return getShareContextClientId();
      });
      seenDuring.push(getShareContextClientId());
      return inner;
    });
    expect(outer).toBe("inner");
    expect(seenDuring).toEqual(["outer", "inner", "outer"]);
  });
});
