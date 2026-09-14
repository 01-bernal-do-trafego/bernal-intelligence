/**
 * MVP COMERCIAL 1.0 — Client Dashboard Share Link.
 * Parse-guard da migration `20260914120000_dashboard_share_links.sql` —
 * NÃO aplicada em nenhum banco; leitura de texto (sem BEGIN/COMMIT
 * explícito, roda em 1 transação pelo runner do Supabase/SQL Editor).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260914120000_dashboard_share_links.sql", import.meta.url),
  ),
  "utf8",
);
const lower = sql.toLowerCase();

describe("1 linha por client — client_id é a PK (nunca dois links ativos por construção)", () => {
  it("client_id uuid primary key references public.clients", () => {
    expect(lower).toMatch(/client_id\s+uuid\s+primary key\s+references\s+public\.clients/);
  });

  it("nenhuma outra coluna `id` própria (client_id É o identificador da linha)", () => {
    expect(lower).not.toMatch(/^\s*id\s+uuid\s+primary key/m);
  });
});

describe("token — só o HASH é persistido, nunca o token em claro", () => {
  it("coluna token_hash text not null", () => {
    expect(lower).toMatch(/token_hash\s+text\s+not null/);
  });

  it("nenhuma coluna para o token em claro (token_plain/token_raw/raw_token/token text sozinho)", () => {
    expect(lower).not.toMatch(/\btoken_plain\b|\btoken_raw\b|\braw_token\b/);
    expect(lower).not.toMatch(/^\s*token\s+text/m);
  });

  it("índice único em token_hash (dois clients nunca compartilham o mesmo hash)", () => {
    expect(lower).toMatch(/create unique index[\s\S]*on public\.dashboard_share_links \(token_hash\)/);
  });

  it("comentário documenta explicitamente 'nunca o token em claro'", () => {
    expect(sql).toMatch(/nunca (é|o) token em claro|token em claro nunca/i);
  });
});

describe("is_active — regenerar é upsert, desativar é update (nunca DELETE)", () => {
  it("coluna is_active boolean not null default false", () => {
    expect(lower).toMatch(/is_active\s+boolean\s+not null\s+default false/);
  });

  it("nenhuma policy de DELETE definida (a tabela nunca perde linhas via RLS)", () => {
    expect(lower).not.toMatch(/for delete/);
  });
});

describe("privilégios — anon SEM NENHUM acesso; authenticated sempre sob RLS", () => {
  it("revoke all from anon, public", () => {
    expect(lower).toMatch(/revoke all on public\.dashboard_share_links from anon, public;/);
  });

  it("grant só select/insert/update para authenticated (nunca delete, nunca para anon)", () => {
    expect(lower).toMatch(/grant select, insert, update on public\.dashboard_share_links to authenticated;/);
    expect(lower).not.toMatch(/grant[^;]*anon/);
  });

  it("RLS habilitada na tabela", () => {
    expect(lower).toMatch(/alter table public\.dashboard_share_links enable row level security;/);
  });
});

describe("policies — só equipe Bernal (is_agency) e só para clientes que ela acessa (can_access_client)", () => {
  for (const action of ["select", "insert", "update"]) {
    it(`policy de ${action} exige is_agency() AND can_access_client(client_id)`, () => {
      const re = new RegExp(
        `create policy dashboard_share_links_${action}_agency[\\s\\S]{0,300}public\\.is_agency\\(\\) and public\\.can_access_client\\(client_id\\)`,
      );
      expect(lower).toMatch(re);
    });
  }

  it("nenhuma policy usa client_user/role diferente de authenticated", () => {
    expect(lower).not.toMatch(/to client_user/);
  });
});

describe("leitura pública (/share/<token>) não depende de nenhuma policy anon aqui", () => {
  it("comentário documenta que a leitura pública passa pelo service_role, fora da RLS", () => {
    expect(sql).toMatch(/service_role/);
  });

  it("nenhuma policy \"to anon\" nesta migration", () => {
    expect(lower).not.toMatch(/to anon/);
  });
});

describe("estrutura geral — idempotente, não executada automaticamente, com rollback manual documentado", () => {
  it('aviso "NÃO É EXECUTADA AUTOMATICAMENTE"', () => {
    expect(sql).toMatch(/NÃO É EXECUTADA AUTOMATICAMENTE/);
  });

  it("create table/index usam IF NOT EXISTS; policies usam DROP POLICY IF EXISTS", () => {
    expect(lower).toMatch(/create table if not exists public\.dashboard_share_links/);
    expect(lower).toMatch(/create unique index if not exists/);
    expect(lower).toMatch(/drop policy if exists dashboard_share_links_select_agency/);
  });

  it("bloco de ROLLBACK MANUAL presente e comentado (não executado)", () => {
    expect(sql).toMatch(/ROLLBACK MANUAL \(NÃO executado por esta migration\)/);
    expect(sql).toMatch(/--\s+drop table if exists public\.dashboard_share_links cascade;/);
  });

  it("trigger de updated_at reaproveita public.set_updated_at() (não reimplementa)", () => {
    expect(lower).toMatch(/execute function public\.set_updated_at\(\);/);
  });
});
