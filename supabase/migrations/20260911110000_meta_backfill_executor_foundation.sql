-- =============================================================================
-- DATA V2.2.2 — Historical Backfill · EXECUTOR FOUNDATION (fencing/heartbeat/retry)
-- Migration: 20260911110000_meta_backfill_executor_foundation
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar. Idempotente
--     (create or replace function).
--
-- FECHA a lacuna deixada na V2.2.1: o schema tinha `lease_token` (fencing),
-- mas nenhuma RPC para de fato FINALIZAR um segmento respeitando-o. Esta
-- migration cria só isso — SEM planner, SEM executor real, SEM chamada à
-- Meta, SEM Cron, SEM meta_rate_budget.
--
-- 4 RPCs, todas SECURITY DEFINER + só service_role (mesmo padrão das demais):
--   complete_backfill_segment(...)         — running -> done | skipped_no_data
--   fail_backfill_segment(...)             — running -> failed
--   extend_backfill_segment_lease(...)     — heartbeat (não muda status)
--   meta_backfill_retry_eligible_segments()— failed -> pending, em lote,
--                                             só quando next_retry_at elegível
--
-- FENCING (compare-and-set): as 3 primeiras SEMPRE filtram
-- `status = 'running' AND lease_token = p_lease_token AND lease_expires_at >
-- now()`. Se 0 linhas forem afetadas, a função devolve `false` — o chamador
-- perdeu a posse (token errado, OU a própria lease já venceu, mesmo que
-- ninguém tenha "reivindicado" o segmento ainda) e NÃO deve tratar isso como
-- sucesso nem tentar de novo com o mesmo token. UMA LEASE EXPIRADA NÃO É MAIS
-- OWNERSHIP VÁLIDO, independentemente de meta_backfill_release_stale_segments()
-- já ter rodado ou não (micro-auditoria pré-Dev: a checagem original só via
-- status+token, sem olhar lease_expires_at, deixava uma janela em que um
-- worker "zumbi" — já expirado, mas ainda não recuperado — conseguia
-- completar/falhar/renovar com sucesso).
--
-- SEMÂNTICA ÚNICA de ownership (micro-auditoria, 2ª rodada — corrige uma
-- inconsistência real entre relatórios anteriores: `claimed_at` chegou a ser
-- descrito ora como preservado, ora como zerado em complete/fail):
--   RUNNING        -> claimed_at, lease_token, lease_expires_at TODOS preenchidos.
--   qualquer outro -> os 3 TODOS nulos.
-- complete_backfill_segment e fail_backfill_segment agora zeram os 3 campos
-- ao chegar em estado terminal/failed. meta_backfill_retry_eligible_segments
-- faz o mesmo ao reabrir failed->pending. attempt_count/last_attempt_at/
-- last_error_code continuam como auditoria histórica (nunca são zerados por
-- estas RPCs) — não são campos de ownership. O invariante é reforçado em
-- nível de banco por meta_backfill_segments_ownership_consistent (migration
-- 20260911100000, seção 4).
--
-- DISTINÇÃO MANTIDA EXPLICITAMENTE: SEGMENT `failed` é retryable
-- (failed -> pending, aqui). JOB `failed` continua TERMINAL (decisão da
-- V2.2.1, reafirmada) — não existe (nem é criada aqui) nenhuma RPC de retry
-- de JOB; retomar = criar um job novo.
--
-- NÃO toca: meta_sync_runs, meta_client_sync_health, Auto Sync, Cron,
-- meta_backfill_jobs/segments (schema — só os DADOS via RPC), rate budget.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. complete_backfill_segment — running -> done | skipped_no_data, com fencing.
-- -----------------------------------------------------------------------------
create or replace function public.complete_backfill_segment(
  p_segment_id    uuid,
  p_lease_token   uuid,
  p_rows_written  integer default null,
  p_pages_fetched integer default null,
  p_outcome       public.meta_backfill_segment_status default 'done'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_segment_id is null or p_lease_token is null then
    raise exception 'complete_backfill_segment: p_segment_id e p_lease_token são obrigatórios';
  end if;
  if p_outcome not in ('done', 'skipped_no_data') then
    raise exception 'complete_backfill_segment: outcome inválido % (só done ou skipped_no_data)', p_outcome;
  end if;
  if p_rows_written is not null and p_rows_written < 0 then
    raise exception 'complete_backfill_segment: p_rows_written não pode ser negativo (recebido %)', p_rows_written;
  end if;
  if p_pages_fetched is not null and p_pages_fetched < 0 then
    raise exception 'complete_backfill_segment: p_pages_fetched não pode ser negativo (recebido %)', p_pages_fetched;
  end if;

  -- MICRO-AUDITORIA (pré-Dev): lease EXPIRADA não é mais posse válida, mesmo
  -- com o token certo — sem isto, um worker "zumbi" (já considerado morto
  -- pelo critério de lease) poderia finalizar com sucesso na janela entre a
  -- lease vencer e meta_backfill_release_stale_segments() rodar (sem Cron
  -- nesta fase). lease_expires_at > now() é exigido junto do lease_token.
  update public.meta_backfill_segments
  set status           = p_outcome,
      rows_written     = coalesce(p_rows_written, rows_written),
      pages_fetched    = coalesce(p_pages_fetched, pages_fetched),
      claimed_at       = null,
      lease_token      = null,
      lease_expires_at = null
  where id = p_segment_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at is not null
    and lease_expires_at > now();

  get diagnostics v_n = row_count;
  return v_n > 0; -- false = fencing: token errado OU lease expirada. NÃO é erro.
end;
$$;

revoke all on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status)
  from public, anon, authenticated;
grant execute on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status)
  to service_role;

comment on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status) is
  'DATA V2.2.2 — finaliza um segmento com SUCESSO (done) ou vazio confirmado '
  '(skipped_no_data). FENCING: só afeta a linha se status=running E '
  'lease_token bater E lease_expires_at ainda não tiver vencido; devolve '
  'false (não lança) se o chamador perdeu a posse (token errado OU lease '
  'expirada) — nunca sobrescreve o trabalho de um worker mais novo. Zera '
  'claimed_at/lease_token/lease_expires_at ao terminar (SEMÂNTICA ÚNICA: só '
  '`running` carrega posse — qualquer outro status tem os 3 nulos, reforçado '
  'pelo constraint meta_backfill_segments_ownership_consistent); '
  'attempt_count/last_attempt_at/last_error_code ficam como auditoria '
  'histórica. Rejeita rows_written/pages_fetched negativos.';

-- -----------------------------------------------------------------------------
-- 2. fail_backfill_segment — running -> failed, com fencing.
-- -----------------------------------------------------------------------------
create or replace function public.fail_backfill_segment(
  p_segment_id    uuid,
  p_lease_token   uuid,
  p_error_code    text default null,
  p_next_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_segment_id is null or p_lease_token is null then
    raise exception 'fail_backfill_segment: p_segment_id e p_lease_token são obrigatórios';
  end if;

  -- MICRO-AUDITORIA (pré-Dev): mesmo motivo de complete_backfill_segment —
  -- lease_expires_at > now() é exigido junto do lease_token.
  update public.meta_backfill_segments
  set status           = 'failed',
      last_error_code  = left(p_error_code, 200),
      next_retry_at    = p_next_retry_at,
      claimed_at       = null,
      lease_token      = null,
      lease_expires_at = null
  where id = p_segment_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at is not null
    and lease_expires_at > now();

  get diagnostics v_n = row_count;
  return v_n > 0; -- false = fencing: token errado OU lease expirada. NÃO é erro.
end;
$$;

revoke all on function public.fail_backfill_segment(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fail_backfill_segment(uuid, uuid, text, timestamptz)
  to service_role;

comment on function public.fail_backfill_segment(uuid, uuid, text, timestamptz) is
  'DATA V2.2.2 — finaliza um segmento com FALHA. Mesmo fencing de '
  'complete_backfill_segment (status=running AND lease_token AND '
  'lease_expires_at > now()). Zera claimed_at/lease_token/lease_expires_at '
  'ao falhar (mesma semântica única de ownership — só `running` os carrega). '
  'p_error_code é sanitizado (nunca SQL/stack bruto — responsabilidade de '
  'quem chama, como já é convenção em sync-core.ts). p_next_retry_at é '
  'opcional — sem cálculo de backoff nesta migration.';

-- -----------------------------------------------------------------------------
-- 3. extend_backfill_segment_lease — heartbeat. NÃO muda status (não dispara
--    a máquina de transição — é um update comum, mesmo fencing).
-- -----------------------------------------------------------------------------
create or replace function public.extend_backfill_segment_lease(
  p_segment_id  uuid,
  p_lease_token uuid,
  p_lease       interval default interval '10 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_segment_id is null or p_lease_token is null then
    raise exception 'extend_backfill_segment_lease: p_segment_id e p_lease_token são obrigatórios';
  end if;
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'extend_backfill_segment_lease: p_lease precisa ser um intervalo positivo (recebido %)', p_lease;
  end if;

  -- MICRO-AUDITORIA (pré-Dev): heartbeat só é válido enquanto a lease ATUAL
  -- ainda não venceu (lease_expires_at > now(), além de status=running AND
  -- lease_token) — um worker que já "estourou" a lease não pode se
  -- ressuscitar sozinho; a posse já é considerada perdida até um claim novo.
  -- GREATEST(...) garante que o heartbeat nunca ENCURTA a lease atual —
  -- só estende (mesmo se p_lease pedido for, por algum motivo, menor que o
  -- tempo restante).
  update public.meta_backfill_segments
  set lease_expires_at = greatest(lease_expires_at, now() + p_lease)
  where id = p_segment_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at is not null
    and lease_expires_at > now();

  get diagnostics v_n = row_count;
  return v_n > 0; -- false = fencing: token errado OU lease já expirada. NÃO é erro.
end;
$$;

revoke all on function public.extend_backfill_segment_lease(uuid, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.extend_backfill_segment_lease(uuid, uuid, interval)
  to service_role;

comment on function public.extend_backfill_segment_lease(uuid, uuid, interval) is
  'DATA V2.2.2 — heartbeat: ESTENDE (nunca encurta — GREATEST com o valor '
  'atual) lease_expires_at do worker ATUAL (compare-and-set por lease_token, '
  'mesmo token — não rotaciona). Exige lease_expires_at > now() além do '
  'token — uma lease já vencida não pode ser renovada por conta própria '
  '(reviver = novo claim). p_lease precisa ser positivo. Segmento continua '
  '`running`. false = a posse já não é mais deste chamador (lease vencida, '
  'já recuperada, ou já finalizada) — o worker deve parar.';

-- -----------------------------------------------------------------------------
-- 4. Retry foundation — segment failed -> pending, em lote, só quando
--    elegível (next_retry_at nulo ou já passou). SEM Cron chamando-a ainda —
--    mesmo padrão de meta_backfill_release_stale_segments (V2.2.1).
--
--    JOB failed CONTINUA TERMINAL — nenhuma RPC de retry de job é criada
--    aqui (decisão da V2.2.1, reafirmada; retomar = job novo).
-- -----------------------------------------------------------------------------
create or replace function public.meta_backfill_retry_eligible_segments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- MICRO-AUDITORIA (pré-Dev): zera lease_token/lease_expires_at/claimed_at
  -- ao reabrir para pending — mesma coerência que running->pending (lease
  -- recuperada) já aplica na trigger de transição. Defensivo mesmo sabendo
  -- que fail_backfill_segment já zera esses campos ao entrar em `failed`:
  -- garante que NENHUM caminho (presente ou futuro) devolve um segmento a
  -- `pending` carregando um lease_token de uma posse anterior.
  -- attempt_count NÃO é resetado aqui — só é incrementado na transição
  -- pending->running (trigger), então o retry preserva o histórico de
  -- tentativas. last_error_code é preservado deliberadamente como
  -- telemetria histórica (decisão desta auditoria) — só é sobrescrito pela
  -- PRÓXIMA falha real, nunca limpo pelo retry.
  update public.meta_backfill_segments
  set status           = 'pending',
      lease_token      = null,
      lease_expires_at = null,
      claimed_at       = null
  where status = 'failed'
    and (next_retry_at is null or next_retry_at <= now());
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.meta_backfill_retry_eligible_segments()
  from public, anon, authenticated;
grant execute on function public.meta_backfill_retry_eligible_segments()
  to service_role;

comment on function public.meta_backfill_retry_eligible_segments() is
  'DATA V2.2.2 — devolve a `pending` todo SEGMENTO `failed` elegível a retry '
  '(next_retry_at nulo ou já passado). Zera lease_token/lease_expires_at/'
  'claimed_at (nenhuma posse residual sobrevive ao retry); attempt_count é '
  'preservado (só a trigger pending->running incrementa); last_error_code é '
  'preservado como telemetria histórica até a próxima falha real. Sem Cron '
  'chamando-a nesta fase. JOB failed continua terminal — isto NÃO reabre '
  'job, só segmento.';

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop function if exists public.meta_backfill_retry_eligible_segments();
--   drop function if exists public.extend_backfill_segment_lease(uuid, uuid, interval);
--   drop function if exists public.fail_backfill_segment(uuid, uuid, text, timestamptz);
--   drop function if exists public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status);
-- =============================================================================
