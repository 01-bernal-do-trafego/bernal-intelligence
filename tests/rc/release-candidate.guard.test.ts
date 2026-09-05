/**
 * Guardas da Release Candidate V1 — protegem decisões da auditoria de produto
 * contra regressão. Parse/estático, sem DB.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeDiscoveryReason } from "@/lib/meta/graph-errors";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${root}${rel}`, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SHIPPED_DIRS = ["app", "components", "server", "lib"].map((d) => `${root}${d}`);
const shippedFiles = SHIPPED_DIRS.flatMap((d) => walk(d));

describe("zero mock em rotas de produção", () => {
  const MOCK_MODULES = [
    "@/lib/mock/dataset",
    "@/lib/mock/demo-performance",
    "@/lib/mock/seed",
    "@/server/portfolio",
    "@/server/mock-helpers",
    "./mock-helpers",
    "./portfolio",
  ];

  it("nenhum arquivo de app/components importa mock (só server/client-dashboard no branch demo)", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles) {
      const rel = file.slice(root.length);
      // exceções: o dispatcher de dashboard mantém o branch demo dev-only
      if (rel === "server/client-dashboard.ts" || rel === "server/period.ts") continue;
      if (rel.startsWith("lib/mock/")) continue;
      const src = readFileSync(file, "utf8");
      if (MOCK_MODULES.some((m) => src.includes(`from "${m}"`))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("o branch demo do dashboard só é alcançável via getAuthMode()", () => {
    const src = read("server/client-data-mode.ts");
    expect(src).toMatch(/getAuthMode\(\)\s*===\s*"demo"/);
  });

  it("getAuthMode: prod sem env -> 'unconfigured' (nunca 'demo')", () => {
    const src = read("supabase/config.ts");
    expect(src).toMatch(/process\.env\.NODE_ENV\s*!==\s*"production"\)\s*return\s*"demo"/);
    expect(src).toMatch(/return\s*"unconfigured"/);
  });

  it("código morto de portfolio foi removido", () => {
    expect(existsSync(`${root}server/portfolio.ts`)).toBe(false);
    expect(existsSync(`${root}components/portfolio`)).toBe(false);
  });
});

describe("estados de rota / 404", () => {
  it("existe um not-found global branded", () => {
    expect(existsSync(`${root}app/not-found.tsx`)).toBe(true);
    const src = read("app/not-found.tsx");
    expect(src).toContain("Página não encontrada");
    expect(src).not.toMatch(/could not be found/i);
  });
  it("cliente inexistente tem not-found próprio", () => {
    expect(existsSync(`${root}app/(app)/clients/[id]/not-found.tsx`)).toBe(true);
  });
});

describe("sidebar: itens 'Em breve' não navegam", () => {
  const src = read("components/layout/sidebar.tsx");
  it("itens soon renderizam <div> não-clicável, não <Link>", () => {
    expect(src).toMatch(/if \(soon\) \{[\s\S]*?<div/);
    expect(src).toMatch(/aria-disabled="true"/);
    expect(src).toMatch(/cursor-not-allowed/);
  });
});

describe("mensagens amigáveis de erro de sync", () => {
  it("acquire_failed e no_eligible_account têm texto de usuário (sem código)", () => {
    const a = describeDiscoveryReason("acquire_failed");
    const b = describeDiscoveryReason("no_eligible_account");
    expect(a).toMatch(/Tente novamente/i);
    expect(a).not.toMatch(/acquire_failed|SQLSTATE|\bcode\b/);
    expect(b).toMatch(/conta de anúncio/i);
  });
  it("reason desconhecido cai em mensagem genérica amigável", () => {
    expect(describeDiscoveryReason("qualquer_coisa_42702")).toMatch(/Tente novamente/i);
  });
});

describe("sem console.log em código shipado (console.error só no error boundary)", () => {
  it("nenhum console.log/console.debug em app/components/server/lib", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles) {
      const src = readFileSync(file, "utf8");
      if (/console\.(log|debug|info)\s*\(/.test(src)) offenders.push(file.slice(root.length));
    }
    expect(offenders).toEqual([]);
  });
  it("console.error só aparece no error boundary do app", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles) {
      const rel = file.slice(root.length);
      if (rel === "app/(app)/error.tsx") continue;
      const src = readFileSync(file, "utf8");
      if (/console\.error\s*\(/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("cópia sem linguagem de área técnica/admin nas rotas de produto", () => {
  it("Criativos: sem 'Área de administração' / códigos Graph / '(dados reais)'", () => {
    const src = read("app/(app)/clients/[id]/creatives/page.tsx");
    expect(src).not.toMatch(/Área de\s*<span[^>]*>administração/);
    expect(src).not.toMatch(/dados reais\)/);
    expect(src).not.toMatch(/Meta \$\{csCodes\}/);
    expect(src).not.toMatch(/insights nível anúncio/);
  });
  it("novo cliente: passos 2/3 não dizem 'não implementada'", () => {
    const src = read("components/clients/new-client-form.tsx");
    expect(src).not.toMatch(/ainda não\s*\n?\s*implementada/);
    expect(src).not.toMatch(/\(UUID\).*gerado pelo banco/);
  });
  it("Sincronizar Meta: sem id de conta nem contagem de stages no resultado", () => {
    const src = read("components/clients/sync-meta-button.tsx");
    expect(src).not.toMatch(/r\.adAccountId\}:/);
    expect(src).not.toMatch(/camp\. ·|linhas\/dia/);
  });
  it("Configurações: não expõe o backend de auth ao usuário", () => {
    const src = read("app/(app)/settings/page.tsx");
    expect(src).not.toContain("Supabase Auth");
    expect(src).not.toContain("MODE_LABEL");
  });
  it("login: erro sem 'Supabase'", () => {
    const src = read("components/auth/login-form.tsx");
    expect(src).not.toMatch(/conectar ao Supabase/);
  });
});

describe("documentação de produção", () => {
  it("docs/PRODUCTION-ENV.md lista as 3 camadas e as vars-chave", () => {
    const src = read("docs/PRODUCTION-ENV.md");
    expect(src).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(src).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(src).toContain("META_APP_SECRET");
    expect(src).toContain("META_TOKEN_ENC_KEY");
    expect(src).toContain("META_SYNC_CRON_SECRET");
    expect(src).toMatch(/Edge Function Secrets/i);
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_(secret|publishable)_[A-Za-z0-9]{6,}/);
  });
  it("docs/GO-LIVE-CHECKLIST.md cobre redirect URI e domínio", () => {
    const src = read("docs/GO-LIVE-CHECKLIST.md");
    expect(src).toMatch(/oauth\/callback/);
    expect(src).toMatch(/META_OAUTH_REDIRECT_URI/);
  });
});

describe("nenhum localhost hardcoded em caminho de produção", () => {
  it("app/components/server/lib não contêm 'localhost' nem '127.0.0.1'", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles) {
      const src = readFileSync(file, "utf8");
      if (/localhost|127\.0\.0\.1/.test(src)) offenders.push(file.slice(root.length));
    }
    expect(offenders).toEqual([]);
  });
});
