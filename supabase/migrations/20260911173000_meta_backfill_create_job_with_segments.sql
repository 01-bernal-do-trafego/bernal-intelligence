-- =============================================================================
-- DATA V2.3A — Historical Backfill Rollout · MATERIALIZAÇÃO ATÔMICA DO JOB
-- Migration: 20260911173000_meta_backfill_create_job_with_segments
--
-- ⚠️  NÃO EXECUTADA. Revisar antes de aplicar (Supabase Studio > SQL Editor, ou
--     `supabase db push`). Idempotente (create or replace function).
--
-- ELIMINA a criação manual de job/segmentos via SQL Editor. O planner
-- (`lib/backfill/planner.ts#planBackfillSegments`, já existente, DATA V2.2.2)
-- continua sendo a ÚNICA fonte de verdade para segmentação — esta RPC NÃO
-- reimplementa segmentação, só MATERIALIZA um `SegmentPlan[]` já calculado.
--
-- ESCOPO: só intervalo EXPLÍCITO (`p_target_start_date`/`p_target_end_date`
-- não-nulos). Discovery / "todo o histórico disponível pela fonte" é a
-- DATA V2.3B (fora desta migration) — `p_target_start_date is null` é
-- rejeitado explicitamente aqui, nunca vira uma data inventada.
--
-- ATOMICIDADE: 1 job + N segmentos na MESMA transação (1 invocação de função
-- = 1 statement do caller = 1 transação). Todas as validações abaixo
-- acontecem ANTES de qualquer INSERT; qualquer exceção (validada aqui OU
-- levantada por uma CONSTRAINT/trigger já existente) aborta a função INTEIRA
-- sem exceção capturada ao redor do INSERT dos segmentos — Postgres desfaz
-- TUDO (job incluso) automaticamente. Zero job e zero segmentos órfãos.
--
-- SERVER-SIDE VALIDATION (não confia cegamente no payload do planner):
--   1. client_id/ad_account_ref obrigatórios;
--   2. target_start_date/target_end_date obrigatórios (nunca null aqui) e
--      start <= end;
--   3. requested_levels não vazio;
--   4. segments não vazio;
--   5. conta pertence ao cliente E está is_linked=true (MESMA regra da
--      trigger meta_backfill_check_account_client — checada aqui também
--      para uma mensagem clara antes de qualquer trabalho; a trigger
--      continua como a garantia real, redundante de propósito);
--   6. nenhum job ATIVO já existe para a conta (MESMA regra do índice único
--      parcial meta_backfill_jobs_one_active_per_account — checada aqui
--      também para mensagem clara; condição de corrida cai no
--      unique_violation, capturado);
--   7. todo segmento tem level PERTENCENTE a requested_levels;
--   8. nenhum segmento com date_from > date_to (invertido);
--   9. nenhum segmento fora do range alvo (target_start..target_end);
--  10. nenhum segmento duplicado (mesmo level+date_from+date_to);
--  11. nenhum overlap de datas DENTRO do mesmo level;
--  12. cobertura EXATA (sem gap, sem overlap, min=target_start,
--      max=target_end) para CADA level solicitado — garante que todo o
--      range alvo está coberto, sem buraco, por todo level pedido.
--
-- JOB criado direto em `running` (não `pending`) — pronto para
-- `claim_next_backfill_segment` imediatamente; `started_at` setado no
-- INSERT (a trigger de transição só carimba isso em UPDATE pending->running,
-- que não se aplica aqui — o job nunca passa por `pending`). Auto-complete
-- (DATA V2.2.4) cuida da finalização quando os segmentos terminarem.
--
-- NÃO toca: claim_next_backfill_segment, complete_backfill_segment,
-- fail_backfill_segment, extend_backfill_segment_lease,
-- meta_backfill_retry_eligible_segments, meta_sync_*, Cron, planner/
-- discovery/executor (TS), Edge Functions existentes.
-- =============================================================================

create or replace function public.create_backfill_job_with_segments(
  p_client_id         uuid,
  p_ad_account_ref    uuid,
  p_requested_levels  public.meta_insight_level[],
  p_target_start_date date,
  p_target_end_date   date,
  p_segments          jsonb
)
returns table (
  job_id        uuid,
  segment_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_count  integer;
begin
  -- 1/2/3/4. obrigatórios + faixa válida + não vazios.
  if p_client_id is null or p_ad_account_ref is null then
    raise exception 'create_backfill_job_with_segments: p_client_id e p_ad_account_ref são obrigatórios';
  end if;
  if p_target_start_date is null then
    raise exception 'create_backfill_job_with_segments: p_target_start_date é obrigatório nesta fase (discovery/"todo o histórico" é a DATA V2.3B, ainda não implementada — nunca inventamos uma data aqui)';
  end if;
  if p_target_end_date is null then
    raise exception 'create_backfill_job_with_segments: p_target_end_date é obrigatório';
  end if;
  if p_target_start_date > p_target_end_date then
    raise exception 'create_backfill_job_with_segments: p_target_start_date (%) é depois de p_target_end_date (%)', p_target_start_date, p_target_end_date;
  end if;
  if p_requested_levels is null or array_length(p_requested_levels, 1) is null then
    raise exception 'create_backfill_job_with_segments: p_requested_levels não pode ser vazio';
  end if;
  if p_segments is null or jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'create_backfill_job_with_segments: p_segments não pode ser vazio (esperado um array jsonb)';
  end if;

  -- 5. conta pertence ao cliente e está linkada.
  if not exists (
    select 1 from public.meta_ad_accounts a
    where a.id = p_ad_account_ref and a.client_id = p_client_id and a.is_linked = true
  ) then
    raise exception 'create_backfill_job_with_segments: ad_account_ref % não pertence ao client_id % ou não está linkada', p_ad_account_ref, p_client_id;
  end if;

  -- 6. nenhum job ATIVO já existente para esta conta.
  if exists (
    select 1 from public.meta_backfill_jobs j
    where j.ad_account_ref = p_ad_account_ref
      and j.status in ('pending', 'running', 'paused')
  ) then
    raise exception 'create_backfill_job_with_segments: já existe um job ativo para a conta % (ad_account_ref)', p_ad_account_ref;
  end if;

  -- 7. todo segmento tem level pertencente a requested_levels.
  if exists (
    with segs as (
      select (elem ->> 'level')::public.meta_insight_level as level
      from jsonb_array_elements(p_segments) as elem
    )
    select 1 from segs where not (level = any (p_requested_levels))
  ) then
    raise exception 'create_backfill_job_with_segments: existe segmento com level fora de p_requested_levels';
  end if;

  -- 8. nenhum segmento invertido (date_from > date_to).
  if exists (
    with segs as (
      select (elem ->> 'date_from')::date as date_from, (elem ->> 'date_to')::date as date_to
      from jsonb_array_elements(p_segments) as elem
    )
    select 1 from segs where date_from > date_to
  ) then
    raise exception 'create_backfill_job_with_segments: existe segmento com date_from depois de date_to';
  end if;

  -- 9. nenhum segmento fora do range alvo.
  if exists (
    with segs as (
      select (elem ->> 'date_from')::date as date_from, (elem ->> 'date_to')::date as date_to
      from jsonb_array_elements(p_segments) as elem
    )
    select 1 from segs where date_from < p_target_start_date or date_to > p_target_end_date
  ) then
    raise exception 'create_backfill_job_with_segments: existe segmento fora do range alvo (% a %)', p_target_start_date, p_target_end_date;
  end if;

  -- 10. nenhum segmento duplicado (mesmo level+date_from+date_to).
  if exists (
    with segs as (
      select (elem ->> 'level')::public.meta_insight_level as level,
             (elem ->> 'date_from')::date as date_from,
             (elem ->> 'date_to')::date as date_to
      from jsonb_array_elements(p_segments) as elem
    )
    select 1 from segs group by level, date_from, date_to having count(*) > 1
  ) then
    raise exception 'create_backfill_job_with_segments: existe segmento duplicado no payload (mesmo level+date_from+date_to)';
  end if;

  -- 11. nenhum overlap de datas DENTRO do mesmo level (self-join, a < b por row_number).
  if exists (
    with segs as (
      select row_number() over () as rn,
             (elem ->> 'level')::public.meta_insight_level as level,
             (elem ->> 'date_from')::date as date_from,
             (elem ->> 'date_to')::date as date_to
      from jsonb_array_elements(p_segments) as elem
    )
    select 1
    from segs a
    join segs b on a.level = b.level and a.rn < b.rn
    where a.date_from <= b.date_to and b.date_from <= a.date_to
  ) then
    raise exception 'create_backfill_job_with_segments: existe overlap de datas dentro do mesmo level';
  end if;

  -- 12. cobertura EXATA por level solicitado: todo level de p_requested_levels
  --     tem >=1 segmento, sem gap, sem overlap (já garantido acima), cobrindo
  --     exatamente [target_start_date, target_end_date].
  if exists (
    select 1 from unnest(p_requested_levels) as rl (level)
    where not exists (
      select 1 from jsonb_array_elements(p_segments) as elem
      where (elem ->> 'level')::public.meta_insight_level = rl.level
    )
  ) then
    raise exception 'create_backfill_job_with_segments: existe level solicitado sem nenhum segmento no payload';
  end if;

  if exists (
    with segs as (
      select (elem ->> 'level')::public.meta_insight_level as level,
             (elem ->> 'date_from')::date as date_from,
             (elem ->> 'date_to')::date as date_to
      from jsonb_array_elements(p_segments) as elem
    ),
    ordered as (
      select
        level, date_from, date_to,
        lag(date_to) over (partition by level order by date_from) as prev_date_to,
        row_number() over (partition by level order by date_from) as rn,
        count(*) over (partition by level) as total,
        min(date_from) over (partition by level) as level_min,
        max(date_to) over (partition by level) as level_max
      from segs
    )
    select 1 from ordered
    where (rn = 1 and level_min <> p_target_start_date)
       or (rn = total and level_max <> p_target_end_date)
       or (prev_date_to is not null and date_from <> prev_date_to + 1)
  ) then
    raise exception 'create_backfill_job_with_segments: cobertura incompleta/gap para algum level — esperado % a % sem buraco', p_target_start_date, p_target_end_date;
  end if;

  -- ---- todas as validações passaram: materializa job + segmentos ----------
  begin
    insert into public.meta_backfill_jobs (
      client_id, ad_account_ref, status, requested_levels,
      target_start_date, target_end_date, started_at
    ) values (
      p_client_id, p_ad_account_ref, 'running', p_requested_levels,
      p_target_start_date, p_target_end_date, now()
    )
    returning id into v_job_id;
  exception when unique_violation then
    raise exception 'create_backfill_job_with_segments: já existe um job ativo para a conta % (condição de corrida)', p_ad_account_ref;
  end;

  insert into public.meta_backfill_segments (job_id, level, date_from, date_to, status)
  select
    v_job_id,
    (elem ->> 'level')::public.meta_insight_level,
    (elem ->> 'date_from')::date,
    (elem ->> 'date_to')::date,
    'pending'
  from jsonb_array_elements(p_segments) as elem;

  get diagnostics v_count = row_count;

  return query select v_job_id, v_count;
end;
$$;

revoke all on function public.create_backfill_job_with_segments(uuid, uuid, public.meta_insight_level[], date, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_backfill_job_with_segments(uuid, uuid, public.meta_insight_level[], date, date, jsonb)
  to service_role;

comment on function public.create_backfill_job_with_segments(uuid, uuid, public.meta_insight_level[], date, date, jsonb) is
  'DATA V2.3A — cria 1 meta_backfill_job + N meta_backfill_segments '
  'ATOMICAMENTE (1 transação), a partir de um SegmentPlan[] já calculado por '
  'lib/backfill/planner.ts (única fonte de verdade de segmentação — esta RPC '
  'NÃO reimplementa segmentação). Só intervalo EXPLÍCITO (target_start_date/'
  'target_end_date obrigatórios; discovery é a DATA V2.3B). Valida no '
  'servidor (não confia no payload): conta pertence ao cliente e is_linked, '
  'nenhum job ativo duplicado, level dos segmentos pertence a '
  'requested_levels, datas não invertidas, dentro do range alvo, sem '
  'duplicata, sem overlap, cobertura exata sem gap por level. Qualquer '
  'segmento inválido -> exception -> ROLLBACK TOTAL (zero job, zero '
  'segmentos). Job criado direto em running, pronto para '
  'claim_next_backfill_segment.';

-- =============================================================================
-- ROLLBACK MANUAL (não executado):
--   drop function if exists public.create_backfill_job_with_segments(uuid, uuid, public.meta_insight_level[], date, date, jsonb);
-- =============================================================================
