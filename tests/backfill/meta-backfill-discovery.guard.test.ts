/**
 * Guardas ESTÁTICAS de `supabase/functions/meta-backfill-discovery/index.ts`
 * (DATA V2.3B). Este arquivo é Deno — não roda aqui, não faz nenhuma
 * chamada real à Meta/Supabase nestes testes.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../../supabase/functions/meta-backfill-discovery/index.ts", import.meta.url)),
  "utf8",
);
const code = src.slice(src.indexOf("*/") + 2);

describe("responsabilidade única — não cria job/segment, não escreve insight, não executa backfill", () => {
  it("nenhuma tabela de backfill/insights é escrita (sem .from(...).insert/.update em jobs/segments/insights)", () => {
    expect(code).not.toContain('.from("meta_backfill_jobs")');
    expect(code).not.toContain('.from("meta_backfill_segments")');
    expect(code).not.toContain('.from("meta_insights_daily")');
  });
  it("não chama nenhuma RPC de backfill (claim/complete/fail/create_backfill_job_with_segments)", () => {
    expect(code).not.toMatch(/admin\.rpc\("(claim_next_backfill_segment|complete_backfill_segment|fail_backfill_segment|create_backfill_job_with_segments)"/);
  });
  it("não chama listInsightsPage (isso é do executor, não do discovery) — só probeAccountInsights/getAdAccountMeta", () => {
    expect(code).not.toContain("listInsightsPage");
    expect(code).toContain("probeAccountInsights");
    expect(code).toContain("getAdAccountMeta");
  });
  it("READ-ONLY — nenhum .update() em meta_connections (diferente do executor, que marca reauthorization_required)", () => {
    expect(code).not.toMatch(/\.from\("meta_connections"\)[\s\S]{0,80}\.update\(/);
  });
});

describe("auth — secret dedicado, tempo constante, nunca JWT de usuário", () => {
  it("usa META_BACKFILL_DISCOVERY_SECRET, header x-meta-backfill-discovery-secret", () => {
    expect(src).toContain("META_BACKFILL_DISCOVERY_SECRET");
    expect(src).toContain('"x-meta-backfill-discovery-secret"');
  });
  it("compara com timingSafeEqual (não ===), 401 em ausente/inválido", () => {
    expect(src).toContain("timingSafeEqual(provided, DISCOVERY_SECRET)");
    expect(src).toMatch(/if \(!provided \|\| !timingSafeEqual\(provided, DISCOVERY_SECRET\)\) \{\s*\n?\s*return json\(\{ error: "unauthorized" \}, 401\)/);
  });
  it("não reaproveita nenhum outro secret no CÓDIGO (só o comentário do topo cita por analogia)", () => {
    expect(code).not.toContain("META_SYNC_CRON_SECRET");
    expect(code).not.toContain("META_BACKFILL_EXECUTOR_SECRET");
    expect(code).not.toContain("META_BACKFILL_ORCHESTRATOR_SECRET");
  });
  it("requireEnv sem fallback inseguro para o secret", () => {
    const line = src.split("\n").find((l) => l.includes("DISCOVERY_SECRET = requireEnv"));
    expect(line).toBeDefined();
    expect(line).not.toContain("??");
  });
  it('documenta "--no-verify-jwt", sem config.toml novo', () => {
    expect(src).toContain("--no-verify-jwt");
    const configPath = fileURLToPath(new URL("../../supabase/config.toml", import.meta.url));
    expect(existsSync(configPath)).toBe(false);
  });
});

describe("connection safety — mesma regra do executor/orchestrator, via helper compartilhado", () => {
  it("usa resolveEligibleAccount (_shared/backfill-eligibility.ts) — não reimplementa a checagem", () => {
    expect(src).toMatch(/from ["']\.\.\/_shared\/backfill-eligibility\.ts["']/);
    expect(src).toContain("resolveEligibleAccount(");
  });
  it("não reimplementa a lista de status elegíveis (não duplica ['active','expiring'] aqui)", () => {
    expect(code).not.toMatch(/\["active",\s*"expiring"\]/);
  });
});

describe("segurança de token — nunca retornado, nunca logado", () => {
  it("importa openToken de _shared/crypto.ts", () => {
    expect(src).toMatch(/from ["']\.\.\/_shared\/crypto\.ts["']/);
  });
  it("console.log só aparece 1x, e não inclui token/lease_token", () => {
    const consoleLogHits = [...src.matchAll(/console\.log\(/g)];
    expect(consoleLogHits).toHaveLength(1);
    const idx = src.indexOf("console.log(");
    const block = src.slice(idx, idx + 300);
    expect(block).not.toMatch(/\btoken\b/i);
  });
});

describe("resultado — sem token/secret, whitelist de campos", () => {
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

describe("fonte de verdade — Meta, nunca banco local/hardcode", () => {
  it("accountCreatedDate vem de meta.createdTime (Graph), nunca de uma constante/coluna local nova", () => {
    expect(code).toContain("meta.createdTime");
    expect(code).not.toMatch(/37\s*mes/i);
    expect(code).not.toMatch(/const\s+\w*RETENTION\w*\s*=/i);
  });
  it("latestClosedDate usa accountTimezone (Meta ao vivo, com fallback local) via accountToday/addDays — nunca UTC fixo/timezone do host", () => {
    expect(src).toContain("addDays(accountToday(accountTimezone), -1)");
    expect(src).not.toContain('Intl.DateTimeFormat("en-CA")'); // não redefine — usa a função compartilhada
  });
  it("timezone preferencial é a resposta AO VIVO da Meta (meta.timezoneName), com fallback ao valor local, nunca UTC silencioso sem fallback", () => {
    expect(src).toContain("meta.timezoneName ?? account.timezone_name ?? \"UTC\"");
  });
});

describe("MAX_DISCOVERY_PROBES", () => {
  it("usa DEFAULT_MAX_DISCOVERY_PROBES do algoritmo compartilhado (não redefine um número mágico aqui)", () => {
    expect(src).toContain("DEFAULT_MAX_DISCOVERY_PROBES");
    expect(src).not.toMatch(/maxProbes:\s*\d+/);
  });
});

describe("range rejection — SÓ code 100 (Invalid parameter) vira range_rejected; nenhuma outra heurística nova", () => {
  function probeBlock(): string {
    const idx = src.indexOf("const probe: ProbeFn = async (range) => {");
    const end = src.indexOf("const outcome = await discoverEarliestDate(");
    return src.slice(idx, end);
  }
  it("RANGE_REJECTION_CODE é 100, comentado como o código real da Meta (não inventado)", () => {
    expect(src).toMatch(/const RANGE_REJECTION_CODE = 100;/);
  });
  it("o probe só classifica range_rejected quando err.code === RANGE_REJECTION_CODE — nunca por .kind sozinho", () => {
    const block = probeBlock();
    expect(block).toMatch(/if \(err\.code === RANGE_REJECTION_CODE\) \{\s*\n?\s*return \{ hasData: false, errorKind: "range_rejected" \};/);
  });
  it("qualquer OUTRO GraphApiError (kind != range) passa err.kind adiante, sem reclassificar", () => {
    const block = probeBlock();
    expect(block).toMatch(/return \{ hasData: false, errorKind: err\.kind \};/);
  });
  it("classifyGraphError NÃO foi ampliado/importado aqui para produzir 'range_rejected' (usa .code, não uma 6ª categoria em GraphErrorKind)", () => {
    expect(code).not.toContain("classifyGraphError");
  });
});

describe("rate pressure — respeitada proativamente, nunca gera fallback, sempre bounded", () => {
  it("canRunDiscoveryNow espelha o MESMO limiar do executor/lib (throttled + app_max_pct/ad_account_max_pct < 60)", () => {
    expect(src).toMatch(/function canRunDiscoveryNow\(\): boolean \{/);
    expect(src).toContain("if (usage.throttled) return false;");
    expect(src).toContain("return usage.app_max_pct < 60 && usage.ad_account_max_pct < 60;");
  });
  it("o probe checa canRunDiscoveryNow() ANTES de chamar probeAccountInsights (sem gastar a chamada HTTP sob pressão)", () => {
    const probeIdx = src.indexOf("const probe: ProbeFn = async (range) => {");
    const guardIdx = src.indexOf("if (!canRunDiscoveryNow())", probeIdx);
    const httpCallIdx = src.indexOf("await probeAccountInsights(", probeIdx);
    expect(guardIdx).toBeGreaterThan(probeIdx);
    expect(guardIdx).toBeLessThan(httpCallIdx);
  });
  it("pressão alta devolve errorKind rate_limited (NUNCA range_rejected) — nunca dispara fallback chunked", () => {
    const probeIdx = src.indexOf("const probe: ProbeFn = async (range) => {");
    const guardBlock = src.slice(probeIdx, src.indexOf("await probeAccountInsights(", probeIdx));
    expect(guardBlock).toMatch(/return \{ hasData: false, errorKind: "rate_limited" \};/);
  });
  it("resetRateUsage() é chamado ANTES do loop de probes (isolamento de invocação, mesma defesa do executor)", () => {
    const resetIdx = src.indexOf("resetRateUsage();");
    const probeDeclIdx = src.indexOf("const probe: ProbeFn");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeLessThan(probeDeclIdx);
  });
  it("não altera o executor — canRunBackfillNow (função do executor) nunca é CHAMADA/IMPORTADA aqui (comentários podem citar o nome, só para documentar o mirror)", () => {
    expect(code).not.toContain("canRunBackfillNow(");
    expect(src).not.toMatch(/from ["']\.\.\/meta-backfill-executor/);
  });
});
