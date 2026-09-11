/**
 * Guardas ESTÁTICAS de `supabase/functions/meta-backfill-orchestrator/index.ts`
 * (DATA V2.3A). Este arquivo é Deno (fronteira Edge Function) — não roda
 * aqui, não faz nenhuma chamada real à Meta/Supabase nestes testes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../supabase/functions/meta-backfill-orchestrator/index.ts", import.meta.url)),
  "utf8",
);
const code = src.slice(src.indexOf("*/") + 2);

describe("auth — secret dedicado, tempo constante, nunca JWT de usuário", () => {
  it("usa META_BACKFILL_ORCHESTRATOR_SECRET, header x-meta-backfill-orchestrator-secret", () => {
    expect(src).toContain("META_BACKFILL_ORCHESTRATOR_SECRET");
    expect(src).toContain('"x-meta-backfill-orchestrator-secret"');
  });
  it("compara com timingSafeEqual (não ===), 401 em ausente/inválido", () => {
    expect(src).toContain("timingSafeEqual(provided, ORCHESTRATOR_SECRET)");
    expect(src).toMatch(/if \(!provided \|\| !timingSafeEqual\(provided, ORCHESTRATOR_SECRET\)\) \{\s*\n?\s*return json\(\{ error: "unauthorized" \}, 401\)/);
  });
  it("não reaproveita META_SYNC_CRON_SECRET/META_BACKFILL_EXECUTOR_SECRET no CÓDIGO (só o comentário do topo pode citar por analogia)", () => {
    expect(code).not.toContain("META_SYNC_CRON_SECRET");
    expect(code).not.toContain("META_BACKFILL_EXECUTOR_SECRET");
  });
  it("requireEnv sem fallback inseguro para o secret (nenhum `??` no requireEnv do secret)", () => {
    const line = src.split("\n").find((l) => l.includes("ORCHESTRATOR_SECRET = requireEnv"));
    expect(line).toBeDefined();
    expect(line).not.toContain("??");
  });
  it('documenta "--no-verify-jwt" (mesmo padrão de meta-sync-scheduled/meta-backfill-executor)', () => {
    expect(src).toContain("--no-verify-jwt");
  });
});

describe("segurança de token/secret — nunca lida, nunca resolvida aqui", () => {
  it("NÃO importa openToken/crypto.ts (esta função nunca decifra token; o comentário do topo só cita openToken para explicar o que NÃO faz)", () => {
    expect(code).not.toContain("openToken");
    expect(src).not.toMatch(/from ["']\.\.\/_shared\/crypto\.ts["']/);
  });
  it("NÃO consulta meta_connection_secrets (só lê has_secret/status de meta_connections)", () => {
    expect(code).not.toContain("meta_connection_secrets");
  });
  it('inspect só seleciona "status, has_secret" de meta_connections — nunca token_cipher/token_iv/token_tag', () => {
    const idx = code.indexOf('.from("meta_connections")');
    const block = code.slice(idx, idx + 150);
    expect(block).toContain('.select("status, has_secret")');
  });
  it("safeLog() nunca recebe token/secret como campo", () => {
    const calls = [...src.matchAll(/safeLog\("[^"]+",\s*\{([\s\S]*?)\}\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).not.toMatch(/\btoken\b|\bsecret\b/i);
    }
  });
});

describe("service_role isolado", () => {
  it("só 1 client criado (admin, service_role) — nenhum client anon/publishable", () => {
    const hits = [...code.matchAll(/createClient\(/g)];
    expect(hits).toHaveLength(1);
    expect(code).toContain("resolveSecretKey()");
    expect(code).not.toContain("resolvePublishableKey");
  });
});

describe("nenhum segundo planner — create só materializa via RPC atômica", () => {
  it("chama create_backfill_job_with_segments (RPC) — não calcula blocos/datas aqui", () => {
    expect(src).toContain('admin.rpc("create_backfill_job_with_segments"');
  });
  it("não importa/reimplementa planBackfillSegments/resolveBlockSizeDays (código real, fora do comentário de topo)", () => {
    expect(code).not.toContain("planBackfillSegments");
    expect(code).not.toContain("resolveBlockSizeDays");
  });
  it("não busca insights Meta nem chama o executor (nenhum fetch/graph.facebook.com/listInsights/RPC de executor no CÓDIGO — comentários podem CITAR o nome do executor por documentação)", () => {
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toContain("graph.facebook.com");
    expect(code).not.toContain("listInsights");
    expect(code).not.toMatch(/admin\.rpc\("(claim_next_backfill_segment|complete_backfill_segment|fail_backfill_segment|extend_backfill_segment_lease)"/);
  });
});

describe("actions suportadas", () => {
  it("dispatch por action: inspect | create | status, default 400", () => {
    expect(src).toMatch(/case "inspect":/);
    expect(src).toMatch(/case "create":/);
    expect(src).toMatch(/case "status":/);
    expect(src).toMatch(/default:\s*\n?\s*return json\(\{ error: "bad_request"/);
  });
});

describe("status — reutiliza meta_backfill_progress, não duplica estado", () => {
  it('consulta a view meta_backfill_progress (não recalcula contadores manualmente)', () => {
    expect(src).toContain('.from("meta_backfill_progress")');
  });
  it("não soma/agrupa segmentos manualmente (sem group by / count(*) próprio)", () => {
    const statusFnIdx = src.indexOf("async function handleStatus");
    const nextFnIdx = src.indexOf("Deno.serve");
    const block = src.slice(statusFnIdx, nextFnIdx);
    expect(block).not.toMatch(/group by/i);
    expect(block).not.toMatch(/count\(\*\)/);
  });
});

describe("create — valida só a FORMA do payload, delega semântica para a RPC", () => {
  it("exige targetStartDate/targetEndDate (discovery é a V2.3B, nunca aceito aqui)", () => {
    const createFnIdx = src.indexOf("async function handleCreate");
    const block = src.slice(createFnIdx, createFnIdx + 1500);
    expect(block).toMatch(/if \(!targetStartDate \|\| !targetEndDate\)/);
  });
  it("mapeia camelCase (dateFrom/dateTo) do payload para snake_case (date_from/date_to) da RPC", () => {
    const createFnIdx = src.indexOf("async function handleCreate");
    const nextFnIdx = src.indexOf("async function handleStatus");
    const block = src.slice(createFnIdx, nextFnIdx);
    expect(block).toContain("date_from: s.dateFrom");
    expect(block).toContain("date_to: s.dateTo");
  });
});

describe("resultado — sem chave inesperada, nunca token/secret", () => {
  function jsonCallObjects(text: string): string[] {
    const out: string[] = [];
    const re = /\bjson\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const openIdx = text.indexOf("{", m.index);
      let depth = 0;
      let i = openIdx;
      for (; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      out.push(text.slice(openIdx + 1, i));
    }
    return out;
  }
  it("nenhum objeto passado a json(...) contém token/secret", () => {
    const blocks = jsonCallObjects(src);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/\btoken\b|\bsecret\b/i);
    }
  });
});
