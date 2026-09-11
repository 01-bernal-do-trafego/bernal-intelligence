# Bernal Intelligence — Historical Backfill Preflight (DATA V2.2A)

> Auditoria + plano + queries READ-ONLY. Este documento não implementa
> backfill, não cria migration, não altera schema. As 14 queries da seção 6
> foram executadas **manualmente por você** no
> **Supabase → Bernal Intelligence Prod → SQL Editor** — nunca por mim; eu não
> tenho (nem usei) acesso de execução ao Prod em nenhum momento desta fase.
>
> **Status: DATA V2.2A CONCLUÍDA.** As seções 1–16 são o plano original
> (mantidas como registro); os **resultados reais** e a **decisão final**
> estão nas seções 17+.

## 1. Objetivo

Responder, com dados reais do Prod (não estimados), antes de desenhar o
Historical Backfill:

1. tamanho real de `meta_insights_daily` hoje;
2. quantidade de linhas e distribuição por nível;
3. intervalo de datas já coberto;
4. quantos clientes/contas existem e o tamanho de cada um (campanhas/conjuntos/
   anúncios);
5. quais índices existem e quanto pesam;
6. se particionar agora é necessário ou prematuro;
7. o risco real de migrar a tabela atual para particionada;
8. como implementar o backfill sem competir com o Auto Sync.

Nenhuma decisão de particionamento é tomada aqui — só o material para decidir
com números reais (seção 11).

---

## 2. Auditoria do schema atual (só leitura do repositório)

### 2.1 `meta_insights_daily`

- **Migration de origem**: `20260902130000_meta_integration.sql` (linhas
  388–459). Nenhuma migration posterior altera sua estrutura — `20260902170000`
  só faz `UPDATE`/`ALTER COLUMN ... SET DEFAULT` (sem DDL estrutural).
- **PK**: `id uuid primary key default gen_random_uuid()` — **surrogate key**,
  não inclui `date`.
- **UNIQUE**: `unique (level, entity_id, date, attribution_window)` — chave
  natural do fato diário. **Inclui `date`.**
- **FKs**: `client_id → clients(id) on delete cascade`; `ad_account_ref →
  meta_ad_accounts(id) on delete cascade`.
- **CHECKs**: `meta_insights_daily_level_ids` (ids obrigatórios por nível),
  `meta_insights_daily_nonneg` (spend/impressions/reach/clicks/frequency ≥ 0).
- **Índices** (todos `create index if not exists`, nenhum único além do
  UNIQUE acima):
  - `meta_insights_daily_client_level_date_idx (client_id, level, date)`
  - `meta_insights_daily_ad_date_idx (ad_id, date) where ad_id is not null`
  - `meta_insights_daily_campaign_date_idx (campaign_id, date) where campaign_id is not null`
  - `meta_insights_daily_adset_date_idx (adset_id, date) where adset_id is not null`
  - `meta_insights_daily_account_date_idx (ad_account_ref, date)`
- **Triggers**: `set_updated_at`; `meta_lock_client_id` (proíbe reatribuir
  `client_id` — isolamento entre clientes, inclusive contra um backfill com bug).
- **RLS**: habilitada; **1 única policy** — `meta_insights_daily_select`
  (`for select to authenticated using (can_access_client(client_id))`). **Sem**
  policy de INSERT/UPDATE/DELETE — só `service_role` escreve (bypassa RLS).
- **Grants**: `revoke all` de `anon/authenticated/public`; `grant select` a
  `authenticated`.
- **Nenhuma FK aponta para `meta_insights_daily.id`** (confirmado por grep em
  todas as migrations) — nada além da própria tabela depende do seu PK.
- **Nenhuma VIEW nem função SQL lê `meta_insights_daily`** (confirmado —
  `meta_client_sync_health` e `meta_eligible_ad_accounts` são as únicas views
  do schema Meta e nenhuma referencia esta tabela).

### 2.2 `meta_insights_periodic` (para contraste)

- Mesma origem (`20260902130000`), PK `id` surrogate.
- UNIQUE atual (após `20260902160000`):
  `meta_insights_periodic_interval_uq (level, entity_id, date_from, date_to, attribution_window)`
  — **inclui `date_from`/`date_to`**.
- RPC `meta_upsert_insights_periodic`:
  `on conflict (level, entity_id, date_from, date_to, attribution_window)`.
- Não é alvo deste backfill (o backfill preenche o **diário**; o periódico
  para intervalos históricos é sob demanda — DATA V2.3).

### 2.3 `meta_campaigns` / `meta_adsets` / `meta_ads`

- PK `id` surrogate; UNIQUE em `campaign_id`/`adset_id`/`ad_id` (ids Meta,
  globais). FKs para `clients`/`meta_ad_accounts`/(campaign/adset pai).
- Índices por `client_id`, `ad_account_ref`, e (`adsets`) `campaign_ref`,
  (`ads`) `adset_ref`, `creative_id`.
- Não são alvo de particionamento (crescem por ENTIDADE, não por dia — não têm
  o mesmo padrão de crescimento).

### 2.4 `meta_sync_runs`

- PK `id` surrogate. Índices: `meta_sync_runs_client_idx (client_id, started_at desc)`,
  `meta_sync_runs_client_started_idx (client_id, started_at desc)` (adicionado em
  `20260903213000` para o cálculo de cooldown), `meta_sync_runs_batch_idx
  (sync_batch_id) where sync_batch_id is not null`.
- **Índice único parcial crítico**: `meta_sync_runs_one_running (ad_account_ref)
  where status = 'running'` — **só 1 sync `running` por conta, em TODO o
  sistema, independente do `trigger`.** Isso já impede Current Sync e Backfill
  de rodarem CONCORRENTEMENTE na mesma conta **se ambos usarem esta tabela**
  (ver seção 8).
- `trigger` enum `meta_sync_trigger` já tem `'backfill'` — **declarado, nunca
  usado**: grep confirma que nenhum código hoje cria uma run com
  `trigger='backfill'` (só existe como membro do tipo TS em `sync-core.ts` e
  do enum SQL).

### 2.5 `meta_ad_accounts`

- Índice único global `meta_ad_accounts_linked_global_uq (ad_account_id) where
  is_linked` — 1 conta linkada pertence a 1 cliente só.
- Colunas relevantes para sizing: `client_id`, `ad_account_id`, `account_name`,
  `is_linked`.

### 2.6 Extensões instaladas (Prod, confirmado na Fase 2 do GO-LIVE)

`pgcrypto 1.3`, `pg_cron 1.6.4`, `pg_net 0.20.4`, `supabase_vault 0.3.1`.

---

## 3. Mapa de dependências de `meta_insights_daily`

| Camada | Arquivo | Uso |
|---|---|---|
| **Escrita** | `supabase/functions/_shared/sync-core.ts:772` | `admin.from("meta_insights_daily").upsert(daily, {onConflict:"level,entity_id,date,attribution_window"})` — único ponto de escrita, `service_role`, Deno |
| **Normalização** | `supabase/functions/_shared/insights.ts` | monta as linhas no formato snake_case da tabela antes do upsert (espelha `lib/meta/sync-insights.ts`/`normalizer.ts` do app) |
| **Leitura — dashboard individual** | `server/real-dashboard.ts:186` | daily nível `account` (gráfico principal) |
| **Leitura — dashboard individual (campanhas)** | `server/real-dashboard.ts:555` | daily nível `campaign` (fallback aditivo da tabela de campanhas) |
| **Leitura — Agency Overview** | `server/agency-overview.ts:297` | daily nível `account`, todas as contas linkadas |
| **Leitura — Criativos** | `server/meta-creatives-data.ts:342` | daily nível `ad` (base da atribuição observacional) |
| **RPC / VIEW (SQL)** | — | **nenhuma.** Nenhuma view/função do banco lê `meta_insights_daily` (grep em todas as migrations) |
| **Lógica pura (sem tocar tabela)** | `lib/meta/daily-coverage.ts`, `date-preset.ts`, `period.ts`, `periodic-select.ts` | calculam `dailyHorizon`, cobertura, ranges — **não** consultam o banco |
| **Metric Registry (V2.0)** | `lib/metrics/registry.ts` | comentário conceitual (`periodic_or_sum` = soma de `meta_insights_daily`) — sem acesso a dado |
| **Query Layer (V2.1)** | `lib/query/types.ts` | `NormalizedDailyRow` — mesmos nomes de coluna, mas é um TIPO puro; a Query Layer não consulta o banco (recebe linhas já buscadas) |
| **UI** | `components/agency/daily-spend-chart.tsx`, `lib/dashboard-config.ts` | comentários/labels — consomem o resultado já processado pelo server, não a tabela |
| **Testes (guard)** | `tests/agency/agency-overview-queries.guard.test.ts` | parse-guard que verifica a FORMA exata da query em `agency-overview.ts` (nível, filtros, range, atribuição) |

**O que quebraria numa migration de particionamento**: só os 4 pontos de leitura
+ o 1 ponto de escrita, e **só se** a sintaxe SQL usada deixasse de ser válida.
Como todas as leituras/escritas são feitas via `supabase-js` (`.select()`/`.upsert()`
com filtros simples `.eq/.in/.gte/.lte`), **nenhuma delas depende de a tabela
ser particionada ou não** — o cliente Postgres/PostgREST não diferencia uma
tabela particionada de uma tabela normal para SELECT/UPSERT simples. O risco
real está inteiramente do lado do **DDL** (constraints, índices, o `ON
CONFLICT`), não do código da aplicação.

---

## 4. Impacto de particionamento — mapeado, não decidido

**Nenhum código de aplicação muda** com particionamento nativo por `RANGE(date)`
(seção 3). O que muda é **inteiramente estrutural**:

| Item | Hoje | Particionada |
|---|---|---|
| PK | `id uuid` sozinho | Postgres exige que a PK inclua a partition key → precisaria virar `(id, date)` |
| UNIQUE natural | `(level, entity_id, date, attribution_window)` | **já inclui `date`** → compatível sem mudança |
| `ON CONFLICT (level, entity_id, date, attribution_window)` | usado no upsert | continuaria funcionando (mesmo arbiter, ver seção 7) |
| Índices parciais (`where ad_id is not null` etc.) | 1 por tabela | precisam existir **por partição** (Postgres cria automaticamente ao herdar da definição da tabela particionada — sem ação manual por partição) |
| RLS | 1 policy na tabela-mãe | RLS em tabela particionada nativa (PG ≥ 11) é herdada pelas partições automaticamente — sem duplicar policy |
| Triggers (`set_updated_at`, `meta_lock_client_id`) | `before update` na tabela | Precisam ser criados como `for each row` na tabela particionada (funciona igual; PG propaga para as partições) |

Isso confirma tecnicamente que **é viável**, mas não diz se **é necessário
agora** — isso só os números reais (seção 6) respondem.

---

## 5. Risco de `ON CONFLICT` + partitioning — relatório explícito

**Constraint real usada no upsert**: `unique (level, entity_id, date, attribution_window)`,
e o `ON CONFLICT` do sync-core usa exatamente essa lista de colunas.

**Regra do Postgres**: numa tabela particionada por `RANGE`/`LIST`/`HASH`, todo
índice único (incluindo o que sustenta `ON CONFLICT`) **precisa incluir a(s)
coluna(s) de particionamento**. Como `date` **já está** na chave natural, este
UNIQUE específico é **compatível de origem** — não precisaria mudar a lista de
colunas do `ON CONFLICT` no código de `sync-core.ts`.

**O que PRECISA mudar** (documentado, não implementado):
1. **A PK `id` sozinha não pode continuar como está.** Precisa virar
   `primary key (id, date)` (ou deixar de ser PK — `id` continuaria `unique`
   apenas dentro de cada partição, o que é aceitável já que nada faz FK para
   ela — seção 2.1).
2. **`ON CONFLICT (level, entity_id, date, attribution_window)` continuaria
   funcionando sem mudança de código** — mesmo texto, porque o índice único
   que o sustenta já contém `date`.
3. **O upsert em lote do sync-core** (`upsert(daily, {...})` com várias linhas
   de datas diferentes na mesma chamada) precisa ser confirmado como seguro —
   PostgREST/`supabase-js` traduz para um único `INSERT ... ON CONFLICT ...
   DO UPDATE`, que funciona normalmente contra tabela particionada (o
   planejador roteia cada linha para a partição certa). **Sem mudança de
   código esperada aqui.**
4. **Risco real não é o `ON CONFLICT` em si — é a conversão da tabela
   existente** (seção 6.3): não dá para simplesmente `ALTER TABLE ...
   PARTITION BY` numa tabela já populada; é preciso recriar/migrar dados.

**Conclusão da seção**: o desenho da chave natural (feito na META 1, antes de
cogitar particionamento) já é **compatível** com partition-by-date. O risco
não está na modelagem da chave — está no **procedimento de conversão** de uma
tabela existente (nunca no schema novo).

---

## 6. Queries READ-ONLY para o Supabase Prod (SQL Editor)

**Regras**: só `SELECT`. Nenhuma altera dado, cria objeto, dropa objeto, roda
`VACUUM`/`ANALYZE` manual, ou tranca a tabela além do `AccessShareLock`
implícito de qualquer `SELECT`. Rode uma de cada vez e me traga os resultados
— não preciso do texto completo se for muita linha, um resumo/print serve.

### QUERY 1 — tamanho total de `meta_insights_daily`
```sql
select
  pg_size_pretty(pg_relation_size('public.meta_insights_daily'))       as table_size,
  pg_size_pretty(pg_indexes_size('public.meta_insights_daily'))        as indexes_size,
  pg_size_pretty(pg_total_relation_size('public.meta_insights_daily')) as total_size;
```

### QUERY 2 — total de linhas
```sql
select count(*) as total_rows from public.meta_insights_daily;
```

### QUERY 3 — linhas por nível
```sql
select level, count(*) as rows
from public.meta_insights_daily
group by level
order by level;
```

### QUERY 4 — menor/maior data por nível
```sql
select
  level,
  min(date) as earliest_date,
  max(date) as latest_date,
  (max(date) - min(date)) as span_days
from public.meta_insights_daily
group by level
order by level;
```

### QUERY 5 — linhas por `client_id`
```sql
select client_id, count(*) as rows
from public.meta_insights_daily
group by client_id
order by rows desc;
```

### QUERY 6 — linhas por conta, com nome do cliente
```sql
select
  i.ad_account_ref,
  a.ad_account_id,
  a.account_name,
  c.name as client_name,
  count(*) as rows
from public.meta_insights_daily i
join public.meta_ad_accounts a on a.id = i.ad_account_ref
join public.clients c on c.id = i.client_id
group by i.ad_account_ref, a.ad_account_id, a.account_name, c.name
order by rows desc;
```

### QUERY 7 — campanhas / conjuntos / anúncios por cliente/conta
```sql
select
  c.name as client_name,
  aa.ad_account_id,
  (select count(*) from public.meta_campaigns camp where camp.ad_account_ref = aa.id) as campaigns,
  (select count(*) from public.meta_adsets   ads2 where ads2.ad_account_ref = aa.id) as adsets,
  (select count(*) from public.meta_ads      ad3  where ad3.ad_account_ref  = aa.id) as ads
from public.meta_ad_accounts aa
join public.clients c on c.id = aa.client_id
where aa.is_linked
order by ads desc;
```

### QUERY 8 — maior conta em número de anúncios
```sql
select aa.ad_account_id, c.name as client_name, count(*) as ads
from public.meta_ads ad
join public.meta_ad_accounts aa on aa.id = ad.ad_account_ref
join public.clients c on c.id = ad.client_id
group by aa.ad_account_id, c.name
order by ads desc
limit 5;
```

### QUERY 9 — índices atuais de `meta_insights_daily`
```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'meta_insights_daily'
order by indexname;
```

### QUERY 10 — tamanho e uso de cada índice
```sql
select
  s.indexrelname as index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
  s.idx_scan   as scans,
  s.idx_tup_read  as tuples_read,
  s.idx_tup_fetch as tuples_fetched
from pg_stat_user_indexes s
where s.schemaname = 'public' and s.relname = 'meta_insights_daily'
order by pg_relation_size(s.indexrelid) desc;
```

### QUERY 11 — dead/live tuples e estatísticas da tabela
```sql
select
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public' and relname = 'meta_insights_daily';
```

### QUERY 12 — dependências de views/funções sobre `meta_insights_daily`
```sql
-- 12a: views/regras que dependem da tabela (catálogo pg_depend/pg_rewrite)
select distinct
  dependent_ns.nspname   as dependent_schema,
  dependent_view.relname as dependent_object,
  dependent_view.relkind as kind
from pg_depend
join pg_rewrite on pg_depend.objid = pg_rewrite.oid
join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
join pg_class as source_table   on pg_depend.refobjid  = source_table.oid
join pg_namespace dependent_ns  on dependent_ns.oid    = dependent_view.relnamespace
where source_table.relname = 'meta_insights_daily'
  and source_table.relnamespace = 'public'::regnamespace
  and dependent_view.oid <> source_table.oid;

-- 12b: funções cujo corpo menciona a tabela (heurística textual, só leitura)
select p.proname
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosrc ilike '%meta_insights_daily%';
```
Expectativa (por leitura do repositório, seção 2.1): **ambas devem vir
vazias.** Se vier algo, é uma dependência não documentada no código-fonte —
investigar antes de qualquer particionamento.

### QUERY 13 — tamanho de todas as tabelas `meta_*`
```sql
select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  n_live_tup as live_rows
from pg_stat_user_tables
where schemaname = 'public' and relname like 'meta\_%' escape '\'
order by pg_total_relation_size(relid) desc;
```

### QUERY 14 — bytes médios por linha (real)
```sql
select
  count(*) as total_rows,
  pg_relation_size('public.meta_insights_daily') as table_bytes,
  pg_relation_size('public.meta_insights_daily') / greatest(count(*), 1) as avg_bytes_per_row
from public.meta_insights_daily;
```

---

## 7. Metodologia de sizing (modelo — sem números ainda)

**Sem preencher nada até termos os resultados reais das queries acima.**

```
rows_per_day(conta)   = 1 (account)
                       + campaigns(conta)
                       + adsets(conta)
                       + ads(conta)

rows_per_day(cliente) = Σ rows_per_day(conta), para cada conta linkada do cliente

estimated_rows(cenário) = Σ_clientes rows_per_day(cliente) × days(cenário)

storage_estimate(cenário) = estimated_rows(cenário) × avg_bytes_per_row (QUERY 14, real)

index_estimate(cenário) ≈ storage_estimate(cenário) × (indexes_size / table_size hoje, QUERY 1)
```

### Matriz a preencher (linhas × colunas, sem números fictícios)

| Cenário histórico ↓ / Base de clientes → | 1 cliente (atual) | 10 clientes | 50 clientes | 100 clientes |
|---|---|---|---|---|
| 12 meses | | | | |
| 24 meses | | | | |
| 36 meses | | | | |
| Todo o período disponível | | | | |

Preenchida depois das QUERY 1–8 e QUERY 14. Cada célula = `estimated_rows` e
`storage_estimate` (tabela + índices) daquele cruzamento, usando `rows_per_day`
médio E máximo observados (QUERY 7/8) — duas linhas por célula (médio/pior
caso), não uma só.

---

## 8. Particionamento — opções auditadas (decisão fica para depois dos números)

| Opção | Descrição | Risco | Downtime | Complexidade operacional |
|---|---|---|---|---|
| **A) Manter sem particionar** | schema atual, índices atuais | nenhum agora; risco cresce com volume (scans mais lentos, autovacuum mais pesado, `VACUUM FULL`/reindex mais caros se precisar) | zero | zero — é o estado atual |
| **B) Particionar a tabela EXISTENTE por `RANGE(date)`** | `ALTER TABLE ... PARTITION BY` não existe no Postgres — na prática significa: criar tabela particionada nova + mover dados + trocar nomes | médio-alto: exige recriar a tabela (não é um `ALTER` simples); PK precisa virar `(id, date)` (seção 5); janela de escrita bloqueada durante o cutover | curto mas real (minutos, dependendo do volume) — pode ser feito com tabela sombra + `INSERT SELECT` + rename atômico para minimizar | média-alta: primeira migração estrutural grande do projeto; exige script de verificação pós-migração (contagem, checksums) |
| **C) Criar tabela particionada nova + dual-write/cutover gradual** | nova tabela particionada recebe escritas novas; dados antigos migrados em lote, depois rename | mais seguro que B (rollback mais fácil — a tabela antiga continua intacta até o cutover), mas mais complexo de coordenar (dual-write temporário) | menor que B (pode ser feito sem downtime, com uma janela de leitura dupla) | alta: mais peças móveis, mais código temporário para descartar depois |
| **D) Não particionar; usar `date` como filtro sempre + BRIN index + retenção/arquivamento por poda (`DELETE`/tabela de arquivo) quando necessário** | index BRIN (muito mais barato que B-tree para colunas append-only como `date`) + política de retenção clara (ex.: nível `ad` mantido N meses) | baixo — aditivo, reversível, sem recriar tabela | zero | baixa — `CREATE INDEX ... USING BRIN(date)` é uma migration pequena e não-bloqueante (`CONCURRENTLY`) |

**Nenhuma opção é assumida como obrigatória.** `D` é o passo mais barato e
reversível e pode ser suficiente por um bom tempo dependendo do que a seção 6
mostrar — mas a decisão fica para a seção 11, com os números reais.

### Item extra: RLS/RPC sob cada opção
- RLS: nas 4 opções, `can_access_client(client_id)` continua funcionando
  identicamente (não depende de particionamento).
- RPCs: nenhuma RPC lê/escreve `meta_insights_daily` diretamente (seção 2.1) —
  nenhum RPC precisa mudar em nenhuma opção.

### Rollback conceitual por opção
- A: n/a (nada muda).
- B: manter a tabela antiga renomeada (`meta_insights_daily_pre_partition`)
  por N dias antes de dropar; reverter = `rename` de volta.
- C: mais simples — a tabela antiga nunca é tocada até o cutover final.
- D: `drop index` do BRIN; política de retenção pode ser desligada sem
  reverter nada (é só parar de rodar a poda).

---

## 9. Backfill vs Current Sync — revisão à luz do schema real

Confirma a separação já desenhada na DATA V2.0 (`docs/DATA-FOUNDATION-V2.md`),
com um achado novo relevante:

### 9.1 Achado: `meta_client_sync_health` NÃO filtra por `trigger`

Lido o SQL completo da view (`20260903214500_fix_creatives_health_incremental.sql`):
`perf_per_account` faz `max(finished_at) filter (stages_done contém os
essenciais)` sobre **todas** as linhas de `meta_sync_runs`, sem `where
trigger <> 'backfill'`. `last_batch`/`batch_runs` pegam o **batch mais
recente por `started_at`**, também sem filtrar `trigger`.

**Consequência se o backfill escrever em `meta_sync_runs`** (mesmo com
`trigger='backfill'`): uma execução de backfill que termine depois do último
sync operacional **pode**:
1. avançar `performance_synced_at` do cliente (parecendo "fresco" por causa de
   um sync que só tocou dados históricos antigos);
2. virar o "último batch" exibido na saúde/health da UI, mostrando o status do
   backfill no lugar do sync operacional real.

**Isso confirma, com evidência concreta (não hipotética), a necessidade
listada na DATA V2.0**: uma migration futura (`sync_health_backfill_aware`)
precisa adicionar `where trigger <> 'backfill'` (ou equivalente) em
`perf_per_account` e em `runs_keyed`/`last_batch`. **Não implementada agora.**

### 9.2 Como aproveitar (ou não) `meta_sync_runs` para o backfill

O índice único parcial `meta_sync_runs_one_running (ad_account_ref) where
status='running'` já impede 2 syncs simultâneos na MESMA conta — mas só se
ambos os processos escreverem em `meta_sync_runs`.

**Recomendação (arquitetural, não implementada)**: o backfill **NÃO** deveria
escrever em `meta_sync_runs` (mantém a tabela de auditoria operacional limpa e
evita o problema da seção 9.1 sem precisar da migration de health ainda) — em
vez disso:
- backfill usa tabelas próprias (`meta_backfill_jobs`/`_segments`, propostas na
  DATA V2.0, ainda não criadas);
- antes de iniciar um segmento numa conta, o backfill faz um **SELECT
  read-only** em `meta_sync_runs` checando `status='running'` para aquele
  `ad_account_ref` e **desiste/adia** se encontrar — pega emprestada a
  exclusividade sem escrever na tabela nem contaminar a saúde.
- Isso é compatível com a migration `sync_health_backfill_aware` sendo feita
  depois (ou nunca, se o backfill nunca tocar `meta_sync_runs`).

### 9.3 O que NÃO deve mudar

`meta_sync_gc_stale`, `meta_sync_acquire_client`, `meta_sync_release`,
`meta_essential_stages`, `meta_clients_due_for_sync`, `sync-core.ts`,
`meta-sync`/`meta-sync-scheduled` (Edge Functions) — **nenhum precisa mudar**
para o backfill existir, se o backfill for um processo/tabelas separados que
só LEEM `meta_sync_runs` (read-only) para a checagem de exclusividade acima.

### 9.4 O que vai precisar existir (futuro, não agora)

`meta_backfill_jobs`, `meta_backfill_segments` (schema já esboçado na DATA
V2.0), um dispatcher próprio (cron separado, prioridade mais baixa que o Auto
Sync), e uma Edge Function de execução de segmento (pode reaproveitar
`runClientSync`/`listInsights` do `sync-core.ts`, mas com `timeRange` do
segmento em vez do horizonte operacional).

---

## 10. Rate limit — o que já existe (auditoria, sem implementar `meta_rate_budget`)

Em `supabase/functions/_shared/graph.ts`:

- **Headers já lidos**: `x-app-usage`, `x-ad-account-usage`,
  `x-business-use-case-usage` (`captureRateUsage(headers)`, chamada a cada
  página de `listEdge`).
- **Acumulador em memória** (por invocação da Edge Function — não persistido):
  ```ts
  interface RateUsageSummary {
    app_max_pct: number;
    ad_account_max_pct: number;
    buc_max_pct: number;
    estimated_time_to_regain_access_max: number;
    throttled: boolean;
  }
  ```
  `resetRateUsage()` / `getRateUsage()` expõem o acumulador; `throttled = true`
  quando qualquer `*_max_pct >= 100` ou `estimated_time_to_regain_access_max > 0`.
- **O que falta para um rate budget real** (DATA V2.2+, não agora):
  1. **persistir** esse resumo (hoje morre com a invocação) — a tabela
     `meta_rate_budget` proposta na DATA V2.0 é exatamente isso;
  2. **ler antes de agir**: hoje `captureRateUsage` só registra DEPOIS da
     chamada — o backfill/enrichment precisam CONSULTAR o budget ANTES de
     decidir se disparam;
  3. **granularidade por recurso**: hoje o acumulador é único por invocação;
     o rate budget real precisa ser por `ad_account_ref` (cada conta tem seu
     próprio limite na Meta) e por app (limite do app inteiro).
- **Classificação de erro já existente** (`classifyGraphError` em `graph.ts` e
  `classifyMetaErrorCode` em `lib/meta/graph-errors.ts`): `rate_limited` já é
  detectado nos códigos `4, 17, 32, 613, 80000` e no `sync-core.ts` já existe
  tratamento de `rate_limited` que interrompe o loop de presets com segurança
  (visto na auditoria da Data Foundation V2, seção "sync-core"). O backfill
  herda essa classificação sem reescrevê-la.

**Conclusão**: a base de leitura de rate limit já existe e é sólida; falta
**persistência** + **consulta prévia** + **granularidade por conta** — os 3
já estavam previstos no plano da DATA V2.0 (`meta_rate_budget`), não
implementados agora.

---

## 11. Granularidade adaptativa do backfill (estratégia, não fixada)

Sem números reais ainda, mas o código já dá 3 sinais concretos para a
heurística adaptativa:

1. **Paginação** (`listEdge`, `graph.ts`): `pageLimit=100`, `maxPages=200`
   (insights) / `maxPages=25` (ad accounts) — estourar isso lança
   `GraphPaginationOverflow`. Um bloco de backfill não pode gerar mais páginas
   que isso para o nível/conta em questão.
2. **Timeout da Edge Function**: limite prático assumido de referência
   ~150s (mesma ordem usada no dimensionamento do `timeout_milliseconds` do
   dispatcher do Auto Sync) — um segmento de backfill precisa terminar
   folgado dentro disso.
3. **Contagem de entidades por conta** (QUERY 7/8) — o fator multiplicador
   real de "linhas por dia" por conta.

**Heurística proposta (mesma da auditoria original da DATA V2.0, refinada)**:
começar com um bloco por nível (`account`: 90d: `campaign`: 30d; `adset`:
14–30d; `ad`: 7–14d) e **auto-reduzir pela metade** se a chamada se aproximar
do limite de páginas ou do timeout — registrado por segmento, não por decisão
global. A escolha FINAL de dias-por-bloco por nível só é travada depois de
ver, na QUERY 7/8, o tamanho real da MAIOR conta (pior caso, não o médio).

---

## 12. Histórico disponível — descoberta, não constante

Não hardcodar nenhum número de meses. Estratégia (não implementada):

1. **Piso conceitual**: `resolved_earliest_date = min(created_time das
   campanhas conhecidas da conta)`; fallback `account.created_time`; fallback
   final = nenhum piso artificial — deixar a Meta responder.
2. **Descoberta real**: o backfill avança do mais recente para o mais antigo,
   em blocos; quando a Meta devolve **0 linhas por N blocos consecutivos**
   (N a definir, ex. 2–3), o job marca `status='exhausted'` com
   `oldest_date_fetched` = a última data que teve dado.
3. **Nenhuma chamada à Meta nesta etapa** — isso é comportamento a implementar
   no bloco de execução (DATA V2.2B ou posterior), não aqui.
4. UI mostraria, quando implementado: "Histórico disponível desde `<data>`" —
   nunca "37 meses" fixo.

---

## 13. Supabase Free — impacto provável (sem decidir upgrade)

- **Storage**: plano Free do Supabase tem um teto de storage do banco
  (na ordem de poucos GB) — comparar com a seção 7 preenchida antes de
  qualquer decisão. Não presumir que vamos estourar; não presumir que não
  vamos.
- **Linhas/índices**: Postgres no Free roda no mesmo motor do Pro — não há
  limite de linhas por si só, só de storage total e de recursos
  (CPU/memória) compartilhados.
- **Backups**: já documentado no GO-LIVE preflight — Free não tem backup
  automático diário; isso é um motivo de upgrade **independente** do
  backfill (mencionado ali, não repetido aqui).
- **Decisão de upgrade**: só depois que a seção 7 estiver preenchida com
  números reais E soubermos o storage real disponível no plano atual (a
  confirmar no painel do Supabase, fora do SQL Editor).

---

## 14. Critérios objetivos para decidir particionar (ou não)

Não "milhões de linhas = particionar". Decisão por **conjunto de sinais**,
todos vindos das queries da seção 6:

| Sinal | Fonte (query) | Pesa a favor de particionar quando... |
|---|---|---|
| Tamanho total da tabela | QUERY 1 | passa de uma fração relevante do storage do plano (calcular após QUERY 1 + confirmar teto do plano) |
| Taxa de crescimento projetada | seção 7 preenchida | o cenário "todo o período × base de clientes-alvo" multiplica o tamanho atual por 10× ou mais |
| Uso real dos índices | QUERY 10 | índices por nível (`ad_date_idx`, `campaign_date_idx`...) mostram `idx_scan` alto E `pg_relation_size` crescendo desproporcional ao ganho de performance — sinal de que o índice está caro de manter |
| Dead tuples / autovacuum | QUERY 11 | `n_dead_tup` alto e/ou `last_autovacuum` distante — indica que o autovacuum já não acompanha o volume de upsert |
| Necessidade de retenção/poda | — | se decidirmos reter só N meses no nível `ad`, particionar por mês torna `DROP PARTITION` trivial (vs. `DELETE` em massa numa tabela não particionada, que gera dead tuples e trava autovacuum) |
| Complexidade da migration vs. benefício | seção 8 | se a Opção D (BRIN + retenção) já resolve o sintoma real medido, particionar nativamente é otimização prematura |

**Regra de decisão proposta**: particionar quando **pelo menos 2 dos 4
primeiros sinais** apontarem para volume real (não projetado) já
significativo, **E** a Opção D (mais barata) já não for suficiente para o
sintoma medido (query lenta, autovacuum atrasado, storage perto do teto). Caso
contrário, começar por D e reavaliar quando o backfill real começar a rodar.

---

## 15. Itens ainda DESCONHECIDOS até rodarmos as queries

- Tamanho real de `meta_insights_daily` hoje (QUERY 1/2).
- Quantas contas/clientes existem de fato no Prod hoje e o tamanho de cada uma
  (QUERY 5/6/7/8) — o preflight de GO-LIVE tinha só 1 conta linkada
  (Atacado do Chinelo); pode já ter mudado.
- Se `meta_client_sync_health` já tem algum resultado inesperado por causa de
  runs antigas (não deveria, já que backfill nunca rodou, mas vale conferir
  via QUERY 11/13 se `meta_sync_runs` já tem volume relevante).
- Teto de storage exato do plano Free atual do projeto Prod (fora do SQL
  Editor — no painel do Supabase, Settings → Billing/Usage).
- Resultado da QUERY 12 — confirmação de que realmente não há view/função
  dependente (a expectativa da auditoria de código é "vazio", mas só a query
  real confirma).

---

## 16. Explicitamente NÃO feito nesta etapa

Nenhuma migration, nenhum SQL executado no Supabase, nenhuma chamada à Meta,
nenhum sync, nenhuma Edge Function/Cron/Vault/secret alterada, nenhum deploy,
nenhuma mudança em `lib/query/` (V2.1) ou `lib/metrics/`+`lib/data-quality.ts`
(V2.0), nenhum código de runtime tocado, nenhum commit, nenhum push. As 14
queries desta seção 6 são para **você** rodar manualmente; eu não tenho (nem
usei) acesso de execução ao Prod nesta etapa.

---

# PARTE 2 — Resultados reais do Prod e decisão final

> As 14 queries da seção 6 foram executadas por você no SQL Editor do
> `Bernal Intelligence Prod`. Os números abaixo são os resultados reais
> reportados — eu não os calculei nem os validei contra o banco (não tenho
> acesso de execução); só organizo e derivo a decisão a partir deles.

## 17. `meta_insights_daily` — sizing real (QUERY 1, 2, 11, 14)

| Métrica | Valor real |
|---|---|
| Total de linhas | **531** |
| Tamanho da tabela | **560 kB** |
| Tamanho dos índices | **216 kB** |
| Tamanho total (tabela + índices) | **816 kB** |
| Bytes médios por linha | **1.018 B** |
| Bytes mínimos por linha | 264 B |
| Bytes máximos por linha | 1.656 B |
| Dead tuples | **0 (0%)** |
| Autovacuum | ativo, já executado |
| Autoanalyze | ativo, já executado |

**Leitura**: tabela minúscula, sem bloat, sem sinal de degradação. Nada aqui
sugere qualquer necessidade operacional imediata.

## 18. Histórico atual (QUERY 3, 4)

- **Intervalo geral**: `2026-08-01` → `2026-09-10` (41 dias corridos de
  calendário; a cobertura real por entidade é menor — ver seção 19).
- **Distribuição por nível**:

| Nível | Linhas |
|---|---|
| account | 73 |
| campaign | 148 |
| adset | 148 |
| ad | 162 |
| **Total** | **531** ✅ bate com QUERY 2 |

## 19. Clientes/contas reais (QUERY 5, 6, 7)

| Cliente | Linhas de insight | Primeira data | Última data | Campaigns | Adsets | Ads | Contas linkadas |
|---|---|---|---|---|---|---|---|
| **Oversized Store** | 286 | 2026-08-01 | 2026-09-10 | 3 | 4 | 9 | 1 |
| **Atacado do Chinelo** | 245 | 2026-08-01 | 2026-09-04 | 10 | 21 | 95 | 1 |
| **Total** | **531** ✅ bate com QUERY 2 | | | | | | |

**Sobre `last_date = 2026-09-04` do Atacado**: registrado explicitamente que
**não é interpretado como falha de sync** — o Auto Sync dessa conta já foi
validado com `status=success` em fases anteriores (checkpoints GO-LIVE V1);
dias sem linha podem ser dias sem entrega registrada pela Meta para aquele
nível/entidade (regra "ausência ≠ falha", já formalizada no `DataQuality` da
DATA V2.0). Nenhuma investigação adicional disparada por este preflight —
fica fora do escopo desta auditoria (é operação do Auto Sync, não do
backfill).

## 20. Maior conta atual (QUERY 8)

**Atacado do Chinelo — 95 ads** é, disparado, a maior conta hoje (Oversized
Store tem 9). Será o **principal candidato para o primeiro teste de carga/
backfill** quando a DATA V2.2 for implementada — é onde a paginação, o
timeout da Edge Function e o rate limit por conta serão exercitados de
verdade primeiro.

## 21. Índices — tamanhos reais (QUERY 9, 10)

| Índice | Tamanho |
|---|---|
| UNIQUE natural `(level, entity_id, date, attribution_window)` | 64 kB |
| PK (`id`) | 40 kB |
| `campaign_date` | 32 kB |
| `client_level_date` | 32 kB |
| `ad_date` | 16 kB |
| `adset_date` | 16 kB |
| `account_date` | 16 kB |
| **Soma** | **216 kB** ✅ bate com QUERY 1 |

Nenhum índice desproporcional; a distribuição de tamanho é a esperada (a
UNIQUE natural e a PK são as maiores por serem as únicas não-parciais que
cobrem 100% das linhas).

## 22. Dependências SQL (QUERY 12)

**`NO ROWS`** nas duas sub-queries (12a — views/regras via `pg_depend`; 12b —
funções cujo corpo menciona a tabela). **Confirma, com dado real, a
expectativa da auditoria de código (seção 2.1/3)**: nenhuma view ou função SQL
depende de `meta_insights_daily`. O único ponto de escrita é o upsert do
`sync-core.ts`; os únicos pontos de leitura são os 4 `server/*.ts` já
mapeados. Isso **reduz ainda mais** o risco de qualquer alteração estrutural
futura na tabela.

## 23. Tamanho das tabelas `meta_*` (QUERY 13)

| Tabela | Tamanho total |
|---|---|
| `meta_insights_daily` | 816 kB |
| `meta_insights_periodic` | 416 kB |
| `meta_ads` | 200 kB |
| `meta_ad_creatives` | 152 kB |
| `meta_adsets` | 144 kB |
| (demais) | menores |

`meta_insights_daily` já é a maior tabela do schema Meta — coerente (é a
única com granularidade diária × entidade), mas em valor absoluto é
irrelevante (< 1 MB).

---

## 24. DECISÃO FINAL — Particionamento

### Particionamento (nativo, `RANGE(date)`)

**DECISÃO: NÃO particionar `meta_insights_daily` agora.** Migration `M2`
**não será criada** nesta fase.

Motivos, cruzando os critérios objetivos da seção 14 com os números reais:

| Sinal (seção 14) | Real | Aponta para particionar? |
|---|---|---|
| Tamanho vs. teto do plano | 816 kB total | Não — ordens de grandeza abaixo de qualquer teto relevante |
| Crescimento projetado (10×+) | seção 25 — indicativo, não medido | Ainda não há medição real de crescimento, só ordem de grandeza |
| Uso real dos índices | todos pequenos (16–64 kB), sem sinal de scan caro | Não |
| Dead tuples / autovacuum | **0% dead tuples**, autovacuum/autoanalyze ativos e já executados | Não |

**0 de 4 sinais** apontam para particionar — a regra da seção 14 ("≥2 de 4")
não é atingida por larga margem.

### BRIN (Opção D)

**DECISÃO: NÃO criar índice BRIN agora.** Com 531 linhas e 216 kB de índices
B-tree convencionais já leves, um BRIN não traria ganho mensurável hoje — e
adicionar um índice sem sintoma medido para justificá-lo é, ele próprio,
otimização prematura.

### Quando revisitar

Particionamento e BRIN **devem ser revisitados** quando houver volume real
maior ou um sintoma medido — ver gatilhos objetivos na seção 26. Não há prazo
fixo; é orientado a sinal, não a calendário.

## 25. Projeção indicativa — ORDEM DE GRANDEZA, NÃO PREVISÃO

Com base na estrutura atual das 2 contas linkadas:

| Cliente | Estrutura | Entidades potenciais/dia (`1 account + campaigns + adsets + ads`) |
|---|---|---|
| Atacado do Chinelo | 1 + 10 + 21 + 95 | **127** |
| Oversized Store | 1 + 3 + 4 + 9 | **17** |
| **Total atual** | | **144 entidades potenciais/dia** |

Aplicando a metodologia da seção 7 (`rows_per_day × days × contas`) — **só
como referência de ordem de grandeza**, não uma previsão:

- 144 entidades/dia × ~1.018 B/linha (QUERY 14 real) ≈ **~147 KB/dia** de
  novo dado, **se** todas as 144 entidades gerassem linha todo santo dia (não
  é o caso hoje — nem toda entidade entrega todos os dias, como já observado
  na seção 19).
- Extrapolando ingenuamente para 12/24/36 meses ou "todo o período
  disponível", ou para 10/50/100 clientes do tamanho médio atual, o resultado
  fica na faixa de **dezenas de MB a poucas centenas de MB** — ordens de
  grandeza, não um número a ser citado como meta ou compromisso.

**ESTA NÃO É UMA PREVISÃO GARANTIDA.** Ressalvas explícitas:

- nem toda entidade entrega todos os dias (cobertura real < 100%, seção 19);
- campanhas/adsets/ads **históricos** (arquivados, pausados há meses) podem
  aumentar bastante o número de entidades quando o backfill alcançar o
  passado — a contagem atual (127+17) é só das entidades **vivas hoje**;
- contas futuras (novos clientes) podem ser muito maiores que as 2 atuais —
  95 ads já é "a maior conta atual", não um teto;
- o tamanho médio por linha (1.018 B) pode crescer com novas métricas
  nativas (DATA V2.4: `outbound_clicks`, quartis de vídeo, `metrics_json`);
- **breakdowns ficarão em tabela separada** (`meta_insights_breakdown_daily`,
  DATA V2.6) — não entram nesta projeção nem devem ser somados a ela.

Uso permitido desta seção: comunicar ordem de grandeza ("estamos falando de
KB/MB, não GB, no cenário atual"). Uso proibido: citar como estimativa de
storage final, como budget de infraestrutura, ou como argumento definitivo
contra reavaliar particionamento no futuro.

## 26. Gatilhos futuros para reavaliar particionamento/BRIN

Reavaliar quando ocorrer uma **combinação** de sinais como:

- crescimento para a casa dos milhões de linhas (não apenas centenas/milhares);
- `meta_insights_daily` passar a representar uma parcela relevante do limite
  de storage do plano Supabase vigente;
- queries de range (dashboard, Agency Overview) degradarem de forma
  **medida** (não achismo — via `EXPLAIN ANALYZE` real);
- `EXPLAIN` mostrar sequential scans ou custo alto onde hoje há index scan
  barato;
- os índices atuais crescerem desproporcionalmente ao volume de linhas
  (sinal de bloat ou de índice mal ajustado);
- autovacuum começar a ficar para trás do volume de upsert (`n_dead_tup`
  crescente entre execuções, `last_autovacuum` cada vez mais distante);
- necessidade real de retenção/poda por período (ex.: descartar `ad` diário
  com mais de N meses) — nesse caso o particionamento vira a ferramenta
  natural (`DROP PARTITION` em vez de `DELETE` em massa);
- entrada de dezenas de clientes novos com contas do porte do Atacado do
  Chinelo (95+ ads) ou maiores, **de fato conectadas** (não só contratadas).

**Nenhum gatilho isolado decide sozinho** — a regra da seção 14 (≥2 de 4
sinais concretos, mais o comparativo custo/benefício da seção 8) continua
valendo para a reavaliação futura.

## 27. Decisão para o backfill — arquitetura confirmada

Aprovado conceitualmente, para implementação na **DATA V2.2**:

- **Current Sync**: continua intocado e **prioritário** — nenhuma mudança em
  `sync-core.ts`, RPCs de acquire/release, Edge Functions `meta-sync`/
  `meta-sync-scheduled`, ou no dispatcher do Auto Sync.
- **Historical Backfill**: processo **separado**, com:
  - idempotência (mesma chave natural `(level, entity_id, date,
    attribution_window)` do upsert atual — nenhuma duplicata possível);
  - resumibilidade (cursor por job/segmento, não um processo monolítico);
  - divisão em segmentos (granularidade adaptativa por nível, seção 11 do
    plano original);
  - consciência de rate limit (consulta ao budget antes de agir — base já
    auditada na seção 10 do plano original, `meta_rate_budget` ainda a
    criar);
  - baixa prioridade **estrita** (nunca compete com o Auto Sync pela mesma
    conta na Meta — ver "achado do health" abaixo);
  - **sem alterar freshness do Current Sync** (não escreve em
    `meta_sync_runs` de um jeito que o afete — ver seção 28);
  - **sem usar `meta_sync_runs` como fonte autoritativa da SUA PRÓPRIA
    saúde** — auditoria própria (`meta_backfill_jobs`/`meta_backfill_segments`,
    ainda não criadas);
  - progresso e retries **próprios** (campos de progresso/tentativa nas
    tabelas de backfill, não reaproveitando `meta_sync_runs.stats`);
  - suporte a **pause/resume** (status por job/segmento, não um "tudo ou
    nada");
  - estados **`exhausted`/`completed`** explícitos (histórico esgotado vs.
    concluído com sucesso são coisas diferentes — só `exhausted` quando a
    Meta devolver vazio por N blocos consecutivos perto do início do
    histórico, seção 12 do plano original).

## 28. Achado do health — confirmado (não apenas hipotético)

Reafirmando com clareza, a partir da leitura completa do SQL da view (plano
original, seção 9.1): **`meta_client_sync_health` hoje não diferencia
`trigger` nenhum** — `perf_per_account` e `last_batch`/`batch_runs` agregam
**todas** as linhas de `meta_sync_runs` indistintamente.

**Consequência prática, se o backfill escrever ali**: uma run de backfill que
termine depois do último sync operacional pode (a) avançar
`performance_synced_at` mesmo tendo processado só dados históricos antigos, e
(b) virar o "último batch" exibido no health/UI no lugar do sync operacional
real.

**Decisão**: o Historical Backfill **não grava runs "normais" em
`meta_sync_runs`** de forma que possam ser interpretadas como Current Sync.
Preferência confirmada: **`meta_backfill_jobs` + `meta_backfill_segments`**
como auditoria própria e independente. A exclusividade operacional (evitar
backfill e Auto Sync disputando a mesma conta na Meta ao mesmo tempo) pode
**consultar** o estado de `meta_sync_runs` (leitura, aproveitando o índice
único parcial `meta_sync_runs_one_running`) — **sem nunca escrever nela** e,
portanto, sem contaminar freshness/health. Nenhuma migration
`sync_health_backfill_aware` é necessária **se** essa regra for seguida à
risca desde o início da DATA V2.2 (o backfill nunca aparece em
`meta_sync_runs`).

## 29. Próxima etapa

**DATA V2.2A — Historical Backfill Preflight: ENCERRADA** após esta aprovação
e o checkpoint correspondente.

**Próxima: DATA V2.2 — Historical Backfill.** Ordem de implementação dentro
dela (antes de qualquer backfill em volume):

1. schema de `meta_backfill_jobs` + `meta_backfill_segments` (migration
   aditiva, sem tocar `meta_insights_daily`/`meta_sync_runs`);
2. executor de segmento (reaproveitando `runClientSync`/`listInsights` do
   `sync-core.ts` com `timeRange` do segmento, não o horizonte operacional);
3. rate-limit safety (consulta ao budget antes de cada segmento — mesmo que
   `meta_rate_budget` comece simples);
4. pause/resume (status por job/segmento);
5. idempotência (mesma chave natural do upsert atual — já garantida por
   desenho, só precisa ser exercitada nos testes);
6. telemetria de progresso (view/consulta de `%`, `oldest_date_fetched`,
   `last_error_code`).

**Primeiro teste deve ser controlado**: 1 conta (candidata natural: **Atacado
do Chinelo**, a maior hoje — seção 20), janela curta, acompanhado
manualmente. **Não iniciar automaticamente o histórico completo de todas as
contas** na primeira execução real.
