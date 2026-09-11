/**
 * Guardas ESTÁTICAS de `supabase/functions/meta-backfill-executor/index.ts`
 * (DATA V2.2.3). Este arquivo é Deno (fronteira Edge Function) — não roda
 * aqui, não faz nenhuma chamada real à Meta/Supabase nestes testes. Protege
 * por leitura de texto as invariantes de segurança/escopo que o Vitest
 * consegue verificar sem um runtime Deno.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../supabase/functions/meta-backfill-executor/index.ts", import.meta.url)),
  "utf8",
);
/** Código real, sem o bloco de comentário /** ... *\/ do topo (que documenta, em
 * prosa, o que NÃO é tocado/reaproveitado — mencionar isso ali é desejado). */
const code = src.slice(src.indexOf("*/") + 2);

describe("17. claim controlado — nunca aceita segment_id do chamador", () => {
  it("o body só lê jobId — nenhum campo segmentId/segment_id é lido do request", () => {
    const bodyParseIdx = src.indexOf("await req.json()");
    const bodyBlock = src.slice(bodyParseIdx, bodyParseIdx + 300);
    expect(bodyBlock).toContain("jobId");
    expect(bodyBlock).not.toMatch(/segmentId|segment_id/);
  });
  it("o claim é SEMPRE pela RPC claim_next_backfill_segment (control plane) — chamada exatamente 1x por invocation", () => {
    const hits = [...src.matchAll(/admin\.rpc\("claim_next_backfill_segment"/g)];
    expect(hits).toHaveLength(1);
  });
  it("não existe loop reivindicando múltiplos segmentos (sem while/for envolvendo claim)", () => {
    const claimIdx = src.indexOf('admin.rpc("claim_next_backfill_segment"');
    const before = src.slice(Math.max(0, claimIdx - 200), claimIdx);
    expect(before).not.toMatch(/for\s*\(|while\s*\(/);
  });
});

describe("16. responsabilidade de UMA unidade de trabalho — nunca vira Cron/loop infinito", () => {
  it("nenhuma menção a cron.schedule/Deno.cron", () => {
    expect(src).not.toContain("cron.schedule");
    expect(src).not.toContain("Deno.cron");
  });
  it("nenhum loop externo chamando a própria função (sem self-recursão/fetch recursivo do próprio endpoint)", () => {
    expect(src).not.toMatch(/fetch\([^)]*meta-backfill-executor/);
  });
});

describe("1. reuso — mesmo normalizador/cliente HTTP/classificação de erro do Current Sync", () => {
  it("importa listInsightsPage/getRateUsage/resetRateUsage/classifyGraphError/GraphApiError de _shared/graph.ts", () => {
    expect(src).toMatch(/from ["']\.\.\/_shared\/graph\.ts["']/);
    expect(src).toContain("listInsightsPage");
    expect(src).toContain("classifyGraphError");
    expect(src).toContain("GraphApiError");
  });
  it("importa toDailyRows de _shared/insights.ts — MESMO normalizador do Current Sync, nenhum outro criado", () => {
    expect(src).toMatch(/from ["']\.\.\/_shared\/insights\.ts["']/);
    expect(src).toContain("toDailyRows(");
  });
  it("importa openToken de _shared/crypto.ts — mesma descriptografia", () => {
    expect(src).toMatch(/from ["']\.\.\/_shared\/crypto\.ts["']/);
  });
  it("NÃO define um normalizeActions/action-type-map próprio (zero duplicação de mapeamento de conversão)", () => {
    expect(src).not.toMatch(/function\s+normalizeActions/);
    expect(src).not.toContain("ACTION_METRIC_SPECS");
  });
  it("upsert usa a MESMA natural key de meta_insights_daily do Current Sync", () => {
    expect(src).toContain('onConflict: "level,entity_id,date,attribution_window"');
  });
});

describe("15. segurança de token — nunca retornado, nunca logado, nunca persistido em claro", () => {
  it("safeLog() nunca recebe token/lease_token como campo", () => {
    const calls = [...src.matchAll(/safeLog\("[^"]+",\s*\{([\s\S]*?)\}\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).not.toMatch(/\btoken\b/i);
    }
  });
  it("json() de resposta nunca inclui token/lease_token nos objetos retornados", () => {
    const calls = [...src.matchAll(/return\s+json\(\s*\{([\s\S]*?)\},\s*\d+,?\s*\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).not.toMatch(/token/i);
    }
  });
  it("console.log só aparece dentro de safeLog (ponto único de log, mais fácil de auditar)", () => {
    const consoleLogHits = [...src.matchAll(/console\.log\(/g)];
    const safeLogDefIdx = src.indexOf("function safeLog");
    // toda ocorrência de console.log deve estar DENTRO da própria função safeLog.
    for (const hit of consoleLogHits) {
      expect(hit.index).toBeGreaterThan(safeLogDefIdx);
    }
    expect(consoleLogHits.length).toBe(1); // só a definição de safeLog usa console.log
  });
});

/** Extrai o objeto literal `{ ... }` que abre logo após cada `json(` (brace-matching — mais robusto que regex para objetos multilinha aninhados). */
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

describe("11. error path — fail com fencing perdido vira refused, nunca finge sucesso; upsert falho nunca completa acidentalmente", () => {
  it("fail() calcula ownershipLost do retorno REAL da RPC (ok.error / ok.data !== true) — nunca assume sucesso", () => {
    const failFnIdx = src.indexOf("const fail = async");
    const block = src.slice(failFnIdx, failFnIdx + 1100);
    expect(block).toMatch(/const ownershipLost = ok\.error != null \|\| ok\.data !== true/);
    expect(block).toMatch(/status: ownershipLost \? "refused" : "failed"/);
  });
  it("upsert falho retorna via fail(...) e NUNCA alcança complete_backfill_segment (só chamado depois do loop, fora do branch de erro)", () => {
    const upsertErrIdx = src.indexOf("if (upsertErr) {");
    const upsertErrBlock = src.slice(upsertErrIdx, upsertErrIdx + 200);
    expect(upsertErrBlock).toMatch(/return await fail\(/);
    expect(upsertErrBlock).not.toContain("complete_backfill_segment");
    // complete_backfill_segment só aparece DEPOIS do loop (após o `for (;;) { ... }` fechar).
    const loopStart = src.indexOf("for (;;) {");
    let depth = 0;
    let i = loopStart + "for (;;) {".length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const loopEnd = i;
    const completeIdx = src.indexOf("complete_backfill_segment");
    expect(completeIdx).toBeGreaterThan(loopEnd);
  });
});

describe("resultado — só campos operacionais seguros (whitelist da seção 20)", () => {
  it("os objetos passados a json(...) usam somente as chaves esperadas — nunca token/lease_token", () => {
    const allowed = new Set([
      "segment_id",
      "job_id",
      "level",
      "date_from",
      "date_to",
      "status",
      "pages_fetched",
      "rows_written",
      "duration_ms",
      "error_class",
      "ownership_lost",
      "reason",
      "error",
      "detail",
    ]);
    const blocks = jsonCallObjects(src);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // só chaves de 1º nível (antes de ":", início de linha ou após "{"/",").
      const keys = [...block.matchAll(/(?:^|[{,]\s*)(\w+):/g)].map((m) => m[1]);
      for (const key of keys) {
        expect(allowed.has(key), `chave inesperada no resultado: ${key}`).toBe(true);
      }
      expect(block).not.toMatch(/\btoken\b/i);
    }
  });
});

describe("18. Current Sync intocado — este arquivo não IMPORTA/CHAMA nada do V1 (comentários — cabeçalho e inline — citam sync-core.ts só como explicação, o que é esperado)", () => {
  it("não importa sync-core.ts nem chama runClientSync()", () => {
    expect(src).not.toMatch(/from\s+["'][^"']*sync-core\.ts["']/);
    expect(src).not.toMatch(/runClientSync\(/);
  });
  it("nenhuma RPC/tabela do Auto Sync V1 é chamada (só mencionada em comentário, para explicar o que NÃO é tocado)", () => {
    expect(code).not.toMatch(/admin\.rpc\("meta_sync_(runs|release|acquire_client)/);
    expect(code).not.toMatch(/\.from\("meta_sync_runs"\)/);
  });
});

describe("6. verify_jwt — mesmo mecanismo de meta-sync-scheduled, sem config.toml", () => {
  it('documenta "O deploy DEVE usar --no-verify-jwt" (mesma frase de meta-sync-scheduled/index.ts)', () => {
    expect(src).toContain("--no-verify-jwt");
  });
  it("supabase/config.toml NÃO existe no projeto (padrão real é flag de deploy, não config versionado)", () => {
    const configPath = fileURLToPath(new URL("../../supabase/config.toml", import.meta.url));
    expect(existsSync(configPath)).toBe(false);
  });
  it("meta-sync-scheduled/index.ts documenta a MESMA obrigação (--no-verify-jwt) — consistência entre as duas funções backend-only", () => {
    const schedSrc = readFileSync(
      fileURLToPath(new URL("../../supabase/functions/meta-sync-scheduled/index.ts", import.meta.url)),
      "utf8",
    );
    expect(schedSrc).toContain("--no-verify-jwt");
  });
});

describe("9. autenticação — secret dedicado, tempo constante, nunca JWT de usuário", () => {
  it("usa META_BACKFILL_EXECUTOR_SECRET; o CÓDIGO não referencia META_SYNC_CRON_SECRET (só o comentário do topo cita o nome, para explicar a decisão)", () => {
    expect(src).toContain("META_BACKFILL_EXECUTOR_SECRET");
    expect(code).not.toContain("META_SYNC_CRON_SECRET");
  });
  it("compara o secret com timingSafeEqual (não ===)", () => {
    expect(src).toContain("timingSafeEqual(provided, EXECUTOR_SECRET)");
  });
});

describe("13. rate usage — mesmo formato de RateUsageSummary, sem meta_rate_budget", () => {
  it("usa getRateUsage()/resetRateUsage() de graph.ts, não reimplementa parsing de header", () => {
    expect(src).toContain("getRateUsage()");
    expect(src).toContain("resetRateUsage()");
    expect(src).not.toContain("x-app-usage");
    expect(src).not.toContain("x-ad-account-usage");
  });
  it("não cria/usa meta_rate_budget", () => {
    expect(src).not.toContain("meta_rate_budget");
  });
});

describe("6. paginação — cursor repetido e overflow abortam com segurança", () => {
  it("detecta cursor repetido (seenCursors) antes de seguir para a próxima página", () => {
    expect(src).toContain("seenCursors.has(nextCursor)");
    expect(src).toContain("pagination_loop_detected");
  });
  it("respeita um teto defensivo de páginas (MAX_PAGES)", () => {
    expect(src).toMatch(/pagesFetched >= MAX_PAGES/);
    expect(src).toContain("pagination_overflow");
  });
});

describe("7/10. heartbeat/ownership — chamado antes do fetch E antes do write, aborta se false", () => {
  it("heartbeat() é chamado 2x por página (antes do request, antes do upsert)", () => {
    const hits = [...src.matchAll(/await heartbeat\(\)/g)];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
  it("perda de ownership nunca chama complete/fail com o token antigo como se ainda fosse dono — usa refused()", () => {
    expect(src).toContain('refused("ownership_lost"');
  });
  it("ORDEM REAL no código: 2º heartbeat() vem ANTES de toDailyRows(...) e do upsert — zero linhas escritas se ownership cair ali", () => {
    const loopStart = src.indexOf("for (;;) {");
    const firstHeartbeatIdx = src.indexOf("await heartbeat()", loopStart);
    const secondHeartbeatIdx = src.indexOf("await heartbeat()", firstHeartbeatIdx + 1);
    const toDailyRowsIdx = src.indexOf("toDailyRows(rawRows", loopStart);
    const upsertIdx = src.indexOf('.from("meta_insights_daily")', loopStart);
    expect(secondHeartbeatIdx).toBeGreaterThan(firstHeartbeatIdx);
    expect(toDailyRowsIdx).toBeGreaterThan(secondHeartbeatIdx);
    expect(upsertIdx).toBeGreaterThan(toDailyRowsIdx);
  });
  it("o 2º heartbeat() retorna (refused) ANTES de qualquer variável rawRows ser normalizada — return está entre o check e o toDailyRows", () => {
    const loopStart = src.indexOf("for (;;) {");
    const firstHeartbeatIdx = src.indexOf("await heartbeat()", loopStart);
    const secondHeartbeatIdx = src.indexOf("await heartbeat()", firstHeartbeatIdx + 1);
    const toDailyRowsIdx = src.indexOf("toDailyRows(rawRows", loopStart);
    const block = src.slice(secondHeartbeatIdx, toDailyRowsIdx);
    expect(block).toMatch(/return refused\("ownership_lost"/);
  });
});

describe("connection status — MESMA regra de meta_eligible_ad_accounts (active|expiring), antes de qualquer chamada Meta", () => {
  function connCheckBlock(): string {
    const idx = src.indexOf("ELIGIBLE_CONNECTION_STATUSES");
    expect(idx, "check de connection status não encontrado").toBeGreaterThan(-1);
    return src.slice(idx, src.indexOf("const { data: secretRow }"));
  }

  it("a lista aceita é EXATAMENTE ['active', 'expiring'] — mesma de meta_eligible_ad_accounts", () => {
    const block = connCheckBlock();
    expect(block).toMatch(/\["active",\s*"expiring"\]/);
  });

  it("status='active' -> elegível (avança); status='expiring' -> elegível (avança)", () => {
    const match = src.match(/const ELIGIBLE_CONNECTION_STATUSES = (\[[^\]]*\]) as const;/);
    expect(match).not.toBeNull();
    const eligible = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(eligible.includes("active")).toBe(true);
    expect(eligible.includes("expiring")).toBe(true);
  });

  it("status='reauthorization_required' -> NÃO elegível; status='revoked' -> NÃO elegível; qualquer outro fora da lista também", () => {
    const match = src.match(/const ELIGIBLE_CONNECTION_STATUSES = (\[[^\]]*\]) as const;/);
    const eligible = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(eligible.includes("reauthorization_required")).toBe(false);
    expect(eligible.includes("revoked")).toBe(false);
    expect(eligible.length).toBe(2); // só active/expiring — nada mais é aceito silenciosamente
  });

  it("consulta meta_connections.status por connection_id (não recria a view, não depende dela)", () => {
    const block = connCheckBlock();
    expect(block).toMatch(/\.from\("meta_connections"\)/);
    expect(block).toMatch(/\.select\("status"\)/);
    expect(block).toMatch(/\.eq\("id",\s*acc\.connection_id\)/);
  });

  it("status fora da lista (ou ausente) -> fail('connection_not_eligible'), ANTES da resolução de secret/token", () => {
    const eligibleIdx = src.indexOf("ELIGIBLE_CONNECTION_STATUSES");
    const secretResolutionIdx = src.indexOf("const { data: secretRow }");
    const openTokenIdx = src.indexOf("openToken(");
    const block = src.slice(eligibleIdx, secretResolutionIdx);
    expect(block).toContain('"connection_not_eligible"');
    expect(eligibleIdx).toBeLessThan(secretResolutionIdx);
    expect(secretResolutionIdx).toBeLessThan(openTokenIdx);
  });

  it("o check acontece ANTES de qualquer chamada a listInsightsPage (nenhum fetch Meta possível sem conexão elegível)", () => {
    const eligibleIdx = src.indexOf("ELIGIBLE_CONNECTION_STATUSES");
    const fetchIdx = src.indexOf("listInsightsPage(");
    expect(eligibleIdx).toBeLessThan(fetchIdx);
  });

  it("NÃO reescreve meta_connections.status neste pré-gate (a conexão já está no estado correto)", () => {
    const block = connCheckBlock();
    expect(block).not.toMatch(/\.update\(/);
    expect(block).not.toContain("markReauthRequired(");
  });
});
