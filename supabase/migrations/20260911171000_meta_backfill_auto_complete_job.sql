-- =============================================================================
-- DATA V2.2.4 — Historical Backfill · AUTOMATIC JOB FINALIZATION
-- Migration: 20260911171000_meta_backfill_auto_complete_job
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (Supabase Studio > SQL Editor, ou
--     `supabase db push`). Idempotente (create or replace function — MESMA
--     assinatura pública de complete_backfill_segment).
--
-- ELIMINA a necessidade de UPDATE manual do job depois que todos os
-- segmentos terminam — achado real do piloto V2.2.3B (Supabase Dev, ver
-- docs/DATA-FOUNDATION-V2.md).
--
-- REGRA: dentro da MESMA invocação de complete_backfill_segment, SE (e
-- SOMENTE SE) o UPDATE fenced do segmento teve sucesso
-- (running -> done | skipped_no_data, token e lease corretos), reconcilia o
-- JOB do segmento:
--
--   job.status = 'running'
--   AND existe pelo menos 1 segmento do job
--   AND NENHUM segmento do job está em pending/running/failed
--   -> job.status = 'completed'
--
-- NUNCA usa `exhausted` aqui — reservado ao fluxo futuro de discovery /
-- "todo o histórico disponível pela fonte" (job explícito com intervalo
-- definido que termina 100% done/skipped_no_data é `completed`, não
-- `exhausted`, mesmo que TODOS os segmentos tenham sido skipped_no_data).
--
-- NÃO auto-finaliza jobs `paused`/`failed`/`cancelled`/`completed`/
-- `exhausted` (só `running` participa da checagem — a condição
-- `j.status = 'running'` no WHERE já garante isso; nenhum caminho altera
-- outro status). NÃO finaliza se existir QUALQUER segmento
-- pending/running/failed.
--
-- ATOMICIDADE: SEM segunda RPC, SEM segunda transação, SEM Edge Function
-- fazendo uma chamada extra. A reconciliação do job acontece DENTRO do
-- corpo de `complete_backfill_segment`, imediatamente depois do UPDATE
-- fenced do segmento, na MESMA invocação de função — que roda como parte da
-- MESMA transação implícita do caller (1 `SELECT complete_backfill_segment(...)`
-- = 1 transação). ASSINATURA PÚBLICA INALTERADA — mesmos 5 parâmetros
-- (p_segment_id, p_lease_token, p_rows_written, p_pages_fetched, p_outcome),
-- mesmo retorno `boolean`. Nenhuma Edge Function precisa mudar.
--
-- FENCING: se o UPDATE do segmento afetar 0 linhas (token errado, OU lease
-- expirada, OU status != running), a função retorna `false` IMEDIATAMENTE —
-- ANTES de qualquer tentativa de tocar no job. Nenhuma auto-finalização pode
-- disparar a partir de um `complete` que na verdade não aconteceu.
--
-- CONCORRÊNCIA: hoje existe no máximo 1 segmento `running` por
-- `ad_account_ref` (DATA V2.2.2), e 1 job = 1 `ad_account_ref` -> na prática,
-- no máximo 1 chamada de `complete_backfill_segment` "em voo" por job a
-- qualquer momento (segmentos do MESMO job são processados em série, nunca
-- em paralelo). Mesmo assim, a checagem `NOT EXISTS` roda DEPOIS do UPDATE
-- fenced do próprio segmento, na MESMA transação: sob uma hipotética
-- concorrência futura (2 segmentos do mesmo job completando quase ao mesmo
-- tempo, se a exclusividade de V2.2.2 mudasse), MVCC/READ COMMITTED garante
-- que:
--   (a) as duas transações nunca corrompem a MESMA linha (cada uma faz
--       UPDATE na SUA PRÓPRIA linha de segmento, `id = p_segment_id`);
--   (b) o UPDATE do job é condicional e IDEMPOTENTE — se a condição não
--       bater mais (0 linhas afetadas), simplesmente não faz nada, não
--       lança erro;
--   (c) NUNCA marca completed um job que na verdade ainda tem um segmento
--       não-terminal: no pior caso (as duas transações não enxergam o
--       commit uma da outra ainda), NENHUMA marca o job `completed` nesta
--       rodada — o padrão desta arquitetura é serializado por desenho
--       (1 running por conta), então esse "pior caso" não ocorre na prática;
--       ficaria apenas como propriedade de segurança para uma mudança futura.
-- Nenhum lock global é necessário — o UPDATE do segmento já serializa via
-- row lock a linha do PRÓPRIO segmento, e a checagem do job só considera o
-- que JÁ está commitado no momento da checagem.
--
-- NÃO toca: fail_backfill_segment, extend_backfill_segment_lease,
-- meta_backfill_retry_eligible_segments, claim_next_backfill_segment,
-- meta_sync_*, Cron, planner/discovery/executor (TS), Edge Function,
-- schema de meta_backfill_jobs/segments (nenhuma coluna nova — `finished_at`
-- já existe desde 20260910120000 e já é carimbado pela trigger
-- meta_backfill_jobs_check_transition ao entrar em `completed`).
-- =============================================================================

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
  v_n      integer;
  v_job_id uuid;
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

  -- FENCING (inalterado desde a micro-auditoria da V2.2.2): lease_expires_at
  -- > now() é exigido junto do lease_token — uma lease EXPIRADA não é mais
  -- posse válida, mesmo com o token certo.
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
    and lease_expires_at > now()
  returning job_id into v_job_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false; -- fencing: token errado OU lease expirada. NÃO toca no job.
  end if;

  -- DATA V2.2.4 — AUTO-FINALIZAÇÃO DO JOB, na MESMA transação, SÓ porque o
  -- UPDATE acima realmente aconteceu (v_n > 0). job `running` + >=1 segmento
  -- + nenhum pending/running/failed restante -> completed. NUNCA `exhausted`
  -- aqui (reservado ao discovery futuro). Jobs paused/failed/cancelled/
  -- completed/exhausted nunca entram (j.status = 'running' no WHERE).
  update public.meta_backfill_jobs j
  set status = 'completed'
  where j.id = v_job_id
    and j.status = 'running'
    and exists (
      select 1 from public.meta_backfill_segments s where s.job_id = j.id
    )
    and not exists (
      select 1 from public.meta_backfill_segments s
      where s.job_id = j.id
        and s.status in ('pending', 'running', 'failed')
    );

  return true;
end;
$$;

revoke all on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status)
  from public, anon, authenticated;
grant execute on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status)
  to service_role;

comment on function public.complete_backfill_segment(uuid, uuid, integer, integer, public.meta_backfill_segment_status) is
  'DATA V2.2.2/V2.2.4 — finaliza um segmento com SUCESSO (done) ou vazio '
  'confirmado (skipped_no_data). FENCING inalterado (status=running AND '
  'lease_token AND lease_expires_at > now()); zera claimed_at/lease_token/'
  'lease_expires_at ao terminar. DATA V2.2.4: na MESMA transação, SE (e só '
  'se) o fencing teve sucesso, reconcilia o JOB do segmento — running + '
  '>=1 segmento + nenhum pending/running/failed restante -> completed '
  '(nunca exhausted, reservado ao discovery futuro). MESMA assinatura '
  'pública, MESMO retorno boolean — nenhuma Edge Function precisa mudar.';

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   -- recriar complete_backfill_segment na versão de 20260911110000
--   -- (sem a reconciliação do job — última seção "1. complete_backfill_segment"
--   -- daquele arquivo).
-- =============================================================================
