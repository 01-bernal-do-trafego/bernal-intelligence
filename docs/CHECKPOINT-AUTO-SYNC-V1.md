# Bernal Intelligence — Checkpoint: Auto Sync V1

> Checkpoint técnico do estado do projeto após a validação em operação real do
> **AUTO SYNC V1 + Creative Sync Incremental**. Registra o que está
> funcionando, com que evidência, e o que ainda não foi feito — não é um
> changelog de commits.
>
> Tag: `checkpoint-auto-sync-v1` · Branch: `feat/fundacao-mvp`

## Estado validado

### Fundação / plataforma
- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript estrito.
- **Supabase Auth real** — sessão de agência, papéis (`agency_admin`/`agency_member`), RLS por `can_access_client`.
- **Clientes reais** cadastrados e navegáveis (não mock).
- **Dashboard configurável por cliente** — `dashboard_configs` (métrica de
  resultado, gráficos, cards), aplicado em leitura, sem re-sync ao trocar.

### Integração Meta Ads
- **OAuth real** (Facebook Login for Business, Configuration ID) — troca de
  code, token cifrado (AES-256-GCM) em tabela dedicada com RLS deny-all,
  nunca exposto ao navegador/Next.js/logs.
- **Descoberta e vínculo de contas de anúncio** (`meta_ad_accounts`), com
  trava cross-cliente e transferência segura em reconexão.
- **Estrutura sincronizada**: campaigns → adsets → ads.
- **Insights diários** (`meta_insights_daily`, granularidade dia — gráficos)
  e **periódicos** (`meta_insights_periodic`, agregado por intervalo — cards;
  `reach`/`frequency` só daqui, nunca somados do diário).
- **Conversões configuráveis**: mapeamento por `action_type` sem dupla
  contagem, atribuição `unified_attribution` (Meta), "Resultado principal"
  por cliente resolvido em leitura (config-driven, sem re-sync).
- **Mensageria validada com dados reais**: Conversas iniciadas, Total de
  contatos, Novos contatos — liberadas no dashboard principal.
- **Creatives reais**: sincronização individual-first (FULL → MINIMAL →
  falha isolada por creative), normalização (imagem/vídeo/carrossel/
  dinâmico) preservando o payload cru (`object_story_spec`/`asset_feed_spec`).
- **Creative sync incremental**: observação `ad → creative` (`last_seen`) a
  cada sync; detalhe FULL só para creative novo, incompleto ou com
  `details_fetched_at` vencido (>24h) — validado economizando **61/61**
  buscas FULL em regime estável.
- **Creative attribution observacional**: janela `[first_seen+1,
  min(last_seen, ontem)]`, boundary days para `first_seen`/`updated_time`,
  três estados (atribuição observada / parcial / histórico não confirmado)
  — nunca alega "provado".

### Sincronização automática (Auto Sync V1)
- **Sync manual** (`meta-sync`, JWT do usuário) e **sync agendada**
  (`meta-sync-scheduled`, `verify_jwt=false` + secret dedicado comparado em
  tempo constante) compartilham o mesmo núcleo (`runClientSync`).
- **Supabase Cron (`pg_cron`) + `pg_net`** — dispatcher a cada 15 min,
  seleciona até 8 clientes elegíveis mais atrasados
  (`meta_clients_due_for_sync`), 1 `net.http_post` independente por cliente,
  `timeout_milliseconds` explícito (acima dos tempos reais observados,
  abaixo do idle timeout da Edge Function).
- **Vault** guarda as credenciais do dispatcher (URL do projeto, publishable
  key, secret do scheduler) — nunca literais em SQL versionado.
- **Acquire atômico por cliente**: todas as contas elegíveis do cliente
  adquirem `running` numa única operação; qualquer conflito reverte tudo
  (`sync_already_running`).
- **Cooldown de retry**: uma tentativa automática que falha não é
  re-disparada a cada 15 min — só depois do cooldown (~4h) ou por ação
  manual do usuário.
- **Freshness em 3 eixos independentes**: performance (idade do dado válido,
  não do status da tentativa), última execução (agregado do batch inteiro,
  não da última conta a terminar), criativos (saúde da etapa — `ok`
  independe de haver upsert, coerente com o incremental em regime estável).
- **Telemetria de rate limit** sanitizada (percentuais máximos de uso),
  não-fatal, sem retry agressivo.

### Validação em operação real (não apenas em teste)
Confirmado por observação direta do primeiro cliente Meta-conectado, ao
longo de ~23h contínuas com o Cron ativo:
- **5 sincronizações automáticas consecutivas**, todas `success`.
- Cadência real observada: **~4h15min** entre execuções (alvo de 4h + até
  15min de granularidade do dispatcher) — sem retry agressivo.
- Em todas: **61/61 creatives conhecidos e pulados** (`known_skipped`),
  **0 buscas FULL** desnecessárias.
- `performance_status = fresh`, `creatives_status = ok`, `rate_usage`
  saudável (sem throttling) em todas as execuções.
- Nenhuma sincronização manual ocorreu durante a janela — toda a atividade
  observada teve `trigger = cron` e `created_by = NULL`.

## Limitações atuais (conhecidas, não são bugs)

- **Visão Geral da agência** ainda mostra dados mockados (não migrada).
- **Intelligence** (score, fadiga de criativo, recomendações, alertas) ainda
  não implementado — fora do escopo até aqui.
- **Google Ads / TikTok Ads** ainda não integrados — só Meta Ads.
- **Creative historical attribution** amadurece por observação contínua:
  quanto mais dias o Bernal observa um `ad→creative`, mais período fica
  atribuível com segurança; não há reconstrução retroativa antes da primeira
  observação.
- **Produção/publicação** ainda não feita — validado até aqui só no projeto
  Supabase de desenvolvimento ("Bernal Intelligence Dev").
- Observabilidade de erro **inesperado** de acquire no scheduler já
  distingue skip esperado de erro real (5xx), mas o cenário estreito de
  "acquire falha antes de criar qualquer run" ainda não tem estado de
  dispatch dedicado — mitigado por ser raro e por já retornar erro visível.

## Onde este estado vive (sem secrets/IDs sensíveis)

- Schema e regras: `supabase/migrations/*.sql` (aplicadas no projeto de
  desenvolvimento, na ordem dos timestamps do nome do arquivo).
- Job do dispatcher: `supabase/ops/meta-auto-sync-dispatch.sql` (operacional,
  idempotente — não é migration).
- Núcleo de sincronização: `supabase/functions/_shared/sync-core.ts`,
  compartilhado por `supabase/functions/meta-sync` (manual) e
  `supabase/functions/meta-sync-scheduled` (agendado).
- Lógica pura testada (espelha o SQL): `lib/meta/*.ts` — atribuição de
  creative, incremental, saúde de sync, elegibilidade de dispatch, tradução
  de resultado para HTTP.
- Suite de testes: `tests/meta/*` (parse-guards de migration + unidade das
  regras puras + render de UI).
