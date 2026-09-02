# Migrations — Bernal Intelligence

Migrations SQL versionadas do banco (Supabase / PostgreSQL).

## Estado atual

| Arquivo | Descrição | Aplicada? |
| --- | --- | --- |
| `20260901120000_phase2_foundation.sql` | Fase 2 — profiles, clients, client_users, dashboard_configs + RLS | Sim |
| `20260902130000_meta_integration.sql` | META 1 — 11 tabelas `meta_*` + RLS | Sim |
| `20260902140000_meta_oauth.sql` | META 2 — RPC `meta_oauth_upsert_connection` (grava conexão + token cifrado numa transação) | **NÃO** |

## Como aplicar (quando autorizado)

Nada aqui roda automaticamente. Duas formas:

**A. Supabase Studio (manual, recomendado para revisão)**
1. Abrir o projeto no Supabase → **SQL Editor**.
2. Colar o conteúdo do arquivo `.sql` e executar. O editor roda tudo em uma transação.

**B. Supabase CLI**
1. `npx supabase login` (token pessoal — feito por você, fora daqui).
2. `npx supabase link --project-ref <ref>`.
3. `npx supabase db push` (aplica as migrations pendentes desta pasta).

## Passos manuais pós-migration (bootstrap)

Descritos no rodapé do próprio arquivo `.sql`:
- criar o primeiro usuário no painel de Authentication;
- promover para `agency_admin` via `update public.profiles ...`;
- desligar "Enable sign-ups" (sem cadastro público);
- associar usuários-cliente a clientes via `public.client_users`.

## Regras

- Nunca commitar `.env.local` nem chaves.
- O app usa apenas a **publishable key** + JWT do usuário — a segurança real é a RLS.
- `service_role` tem bypass de RLS e **não deve ser usada pela aplicação**.
