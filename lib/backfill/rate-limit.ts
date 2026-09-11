/**
 * DATA V2.2.2 — Historical Backfill. Contrato de rate limit. Módulo PURO.
 *
 * NÃO cria `meta_rate_budget` (persistência) nesta fase — decisão explícita:
 * o executor real ainda não chama a Meta, então não há budget real para
 * persistir ainda. Isto é só o CONTRATO que o futuro executor consulta antes
 * de reivindicar/rodar um segmento (`canRunBackfill`), moldado no formato que
 * `RateUsageSummary` já produz em `supabase/functions/_shared/graph.ts`
 * (app_max_pct/ad_account_max_pct/buc_max_pct/throttled) — quando
 * `meta_rate_budget` existir, um snapshot dele vira este mesmo shape sem
 * mudar a assinatura de `canRunBackfill`.
 *
 * Prioridade (arquitetura original da Data Foundation V2): Current Sync >
 * dashboard on-demand > Historical Backfill > enriquecimentos. Os limiares
 * default abaixo refletem isso — o backfill só roda com folga de sobra.
 */

export interface RateBudgetSnapshot {
  appUsagePct: number;
  adAccountUsagePct: number;
  bucUsagePct: number;
  throttled: boolean;
}

export interface RateLimitThresholds {
  maxAppUsagePct: number;
  maxAdAccountUsagePct: number;
}

/** Conservador de propósito — o backfill é a prioridade mais baixa do sistema. */
export const DEFAULT_BACKFILL_RATE_THRESHOLDS: RateLimitThresholds = {
  maxAppUsagePct: 60,
  maxAdAccountUsagePct: 60,
};

/**
 * `true` quando o backfill pode prosseguir AGORA para a conta, dado o
 * snapshot mais recente conhecido. `snapshot: null` = nenhum dado ainda
 * (primeira chamada) -> otimista, permite (não há como ainda saber que está
 * perto do limite). `throttled: true` sempre bloqueia, independente dos %.
 */
export function canRunBackfill(
  snapshot: RateBudgetSnapshot | null,
  thresholds: RateLimitThresholds = DEFAULT_BACKFILL_RATE_THRESHOLDS,
): boolean {
  if (snapshot === null) return true;
  if (snapshot.throttled) return false;
  return (
    snapshot.appUsagePct < thresholds.maxAppUsagePct &&
    snapshot.adAccountUsagePct < thresholds.maxAdAccountUsagePct
  );
}
