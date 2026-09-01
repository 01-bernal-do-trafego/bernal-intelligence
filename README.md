# Bernal Intelligence

Plataforma própria de inteligência e dashboards de mídia paga da **Bernal do Tráfego**.

Esta é a **fundação** do produto: interface, design system, shell autenticado e
dashboards funcionando com **dados mockados**. Ainda **não há** integração com
Meta Ads, IA, alertas automáticos, Google/TikTok ou CRM — a arquitetura foi
desenhada para receber esses módulos depois.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **TypeScript** estrito
- **Tailwind CSS v4** (design tokens em `app/globals.css`)
- **Supabase** (`@supabase/ssr`) — Supabase Auth preparado
- **Recharts** para gráficos
- **Vitest** para testes de unidade

## Rodando localmente

Requisitos: **Node.js 20+** (testado no Node 24).

```bash
npm install
npm run dev
# http://localhost:3000
```

### Variáveis de ambiente

O arquivo `.env.local` já existe na raiz com os campos **vazios**:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Preencha com os valores do seu projeto Supabase (use a chave **publishable/anon**,
nunca a `service_role`). O `.env.local` está no `.gitignore` e **nunca** deve ser
versionado. Um modelo versionado fica em `.env.example`.

### Modos de autenticação

O comportamento depende das variáveis acima (`supabase/config.ts`):

| Situação | Modo | Comportamento |
| --- | --- | --- |
| Variáveis preenchidas | `supabase` | Autenticação real via Supabase Auth |
| Vazias, em desenvolvimento | `demo` | "Modo demonstração": libera a navegação local com dados fictícios |
| Vazias, em produção | `unconfigured` | Acesso negado — tudo redireciona para `/login`. Nunca há bypass de autenticação em produção |

## Scripts

| Comando | Ação |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run start` | Sobe o build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes (Vitest) |

## Estrutura

```
app/
  (auth)/login/         # tela de login
  (app)/                # área autenticada (shell + rotas)
    page.tsx            # Home / Visão geral (carteira)
    clients/            # lista, novo cliente, dashboard /clients/[id]
    intelligence|templates|settings/   # placeholders
components/
  ui/                   # design system (Button, Input, Modal, DataTable, ...)
  layout/               # Sidebar, Topbar, AppShell
  charts/               # TrendChart (Recharts)
  portfolio/ clients/ client-dashboard/ shared/
lib/
  metrics.ts            # CTR/CPC/CPM/custo por resultado (sobre totais brutos)
  comparison.ts         # variação % + classificação por comportamento da métrica
  date-range.ts         # presets de período e faixas
  format.ts             # formatação pt-BR (blindada contra NaN/Infinity)
  series.ts  cn.ts
  mock/                 # fonte mock ÚNICA e determinística (seed fixa)
server/                 # camada de consulta (recalcula os mocks por filtro)
types/                  # modelo de domínio
tests/                  # testes de unidade
supabase/               # clients SSR + proxy de sessão
proxy.ts                # convenção do Next 16 (ex-middleware): sessão + guarda de rota
```

### Regras de métricas

Métricas derivadas **nunca** são a média das métricas diárias. Sempre se somam os
totais brutos (investimento, impressões, cliques, resultados) e só então se
calcula a razão — ver `lib/metrics.ts` e `tests/metrics.test.ts`.

## Roadmap (próximas fases)

- Integração Meta Ads (OAuth + ingestão)
- Persistência de clientes/contas no Supabase (+ RLS)
- Google Ads, TikTok Ads, Kommo CRM
- Alertas de performance e de orçamento
- Recomendações e otimizações assistidas por IA
- Dashboard compartilhável (forte prioridade mobile)
