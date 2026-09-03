/**
 * Atribuição observacional de performance ad → creative. Módulo PURO.
 *
 * A Meta NÃO fornece a cronologia da troca de criativo. O Bernal só sabe o que
 * OBSERVOU: `meta_ad_creatives.first_seen`/`last_seen` são datas de
 * SINCRONIZAÇÃO em que o par (ad, creative) foi visto — não a veiculação real.
 *
 * Regra (dia a dia, granularidade de `meta_insights_daily`):
 *  - janela observacional do par = [first_seen, last_seen];
 *  - o DIA de `first_seen` é BOUNDARY (contém atividade anterior à 1ª
 *    observação) -> excluído; a janela segura começa em first_seen + 1;
 *  - `ad.updated_time` dentro da janela é INCERTEZA (não prova troca, mas o ad
 *    foi editado) -> o dia da edição é boundary e a janela segura só começa em
 *    updated_time + 1; `updated_time` DEPOIS de last_seen -> nada é atribuível
 *    (não reobservamos o ad após a edição);
 *  - "hoje" nunca vira histórico confirmado: a janela segura termina em
 *    min(last_seen, ontem);
 *  - outra relação de creative observada para o mesmo ad -> o intervalo entre
 *    as janelas é gap de troca, excluído;
 *  - dias fora da janela segura entram em buckets de exclusão com motivo.
 *
 * Estados (confiança OBSERVACIONAL do Bernal, não prova):
 *  FULLY_ATTRIBUTABLE     — janela segura cobre o período todo, 1 relação, sem edição dentro
 *  PARTIALLY_ATTRIBUTABLE — parte atribuível, resto em buckets de incerteza
 *  UNATTRIBUTABLE         — nenhum dia atribuível no período
 */

import { addDays, eachDay } from "@/lib/date-range";

export type AttributionStatus =
  | "FULLY_ATTRIBUTABLE"
  | "PARTIALLY_ATTRIBUTABLE"
  | "UNATTRIBUTABLE";

export type ExclusionReason =
  | "pre_first_observation"
  | "boundary_observation_day"
  | "boundary_edit_day"
  | "edited_within_period"
  | "post_last_observation"
  | "boundary_today"
  | "creative_swap_gap"
  | "not_observed";

export interface ObservedRelation {
  /** first_seen truncado para YYYY-MM-DD (data de sincronização) */
  firstSeen: string;
  /** last_seen truncado para YYYY-MM-DD */
  lastSeen: string;
}

export interface AttributionInput {
  period: { start: string; end: string };
  /** "hoje" no fuso da conta (YYYY-MM-DD) */
  today: string;
  /** relação observada (ad, ESTE creative). `null` = nunca observada nesse ad. */
  relation: ObservedRelation | null;
  /** relações observadas do MESMO ad com OUTROS creatives */
  otherRelations: ObservedRelation[];
  /** `meta_ads.updated_time` truncado para YYYY-MM-DD, se houver */
  adUpdatedDate: string | null;
}

export interface AttributionWindow {
  status: AttributionStatus;
  /** dias do período atribuíveis com segurança (YYYY-MM-DD, ordenados) */
  attributableDates: string[];
  /** dias do período NÃO atribuíveis, com motivo */
  excluded: { date: string; reason: ExclusionReason }[];
}

const maxDate = (a: string, b: string) => (a >= b ? a : b);
const minDate = (a: string, b: string) => (a <= b ? a : b);

export function attributeAdToCreative(
  input: AttributionInput,
): AttributionWindow {
  const { period, today, relation, otherRelations, adUpdatedDate } = input;
  const periodDays = eachDay(period);
  const yesterday = addDays(today, -1);

  if (!relation) {
    return {
      status: "UNATTRIBUTABLE",
      attributableDates: [],
      excluded: periodDays.map((date) => ({ date, reason: "not_observed" })),
    };
  }

  const fs = relation.firstSeen;
  const ls = relation.lastSeen;
  const editedAfterLastObservation =
    adUpdatedDate != null && adUpdatedDate > ls;
  const editInWindow =
    adUpdatedDate != null && adUpdatedDate >= fs && adUpdatedDate <= ls;

  const hasOtherObserved = otherRelations.length > 0;

  // início da janela segura: dia seguinte ao boundary (first_seen e, se houver,
  // dia da edição dentro da janela) e ao fim de qualquer janela de outro
  // creative que encoste na nossa.
  let safeStart = addDays(fs, 1);
  if (editInWindow) safeStart = maxDate(safeStart, addDays(adUpdatedDate!, 1));
  // só aperta o início se a janela de OUTRO creative SOBREPÕE a nossa
  // (começou antes do nosso fim E terminou depois do nosso início) — aí há
  // ambiguidade real na borda inicial. Um creative anterior que terminou antes
  // do nosso first_seen já é tratado pelo boundary de first_seen + gap.
  for (const r of otherRelations) {
    if (r.firstSeen <= ls && r.lastSeen >= fs) {
      safeStart = maxDate(safeStart, addDays(r.lastSeen, 1));
    }
  }

  // fim da janela segura: última observação, mas nunca "hoje".
  const safeEnd = minDate(ls, yesterday);

  const attributable: string[] = [];
  const excluded: { date: string; reason: ExclusionReason }[] = [];

  for (const date of periodDays) {
    const inSafe =
      !editedAfterLastObservation && date >= safeStart && date <= safeEnd;
    if (inSafe) {
      attributable.push(date);
      continue;
    }
    excluded.push({ date, reason: reasonFor(date) });
  }

  function reasonFor(date: string): ExclusionReason {
    if (date === today) return "boundary_today";
    if (date > safeEnd) return "post_last_observation";
    if (date === fs) return "boundary_observation_day";
    if (editInWindow && adUpdatedDate != null && date === adUpdatedDate) {
      return "boundary_edit_day";
    }
    if (
      date >= fs &&
      date < safeStart &&
      (editInWindow || editedAfterLastObservation)
    ) {
      return "edited_within_period";
    }
    if (editedAfterLastObservation && date >= fs) return "edited_within_period";
    if (date < fs) {
      return hasOtherObserved ? "creative_swap_gap" : "pre_first_observation";
    }
    return "pre_first_observation";
  }

  let status: AttributionStatus;
  if (attributable.length === 0) {
    status = "UNATTRIBUTABLE";
  } else if (
    attributable.length === periodDays.length &&
    otherRelations.length === 0 &&
    (adUpdatedDate == null || adUpdatedDate < fs)
  ) {
    status = "FULLY_ATTRIBUTABLE";
  } else {
    status = "PARTIALLY_ATTRIBUTABLE";
  }

  return { status, attributableDates: attributable, excluded };
}

/** Rótulo curto de um motivo de exclusão para a UI. */
export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  pre_first_observation: "antes da 1ª sincronização",
  boundary_observation_day: "dia da 1ª observação (parcial)",
  boundary_edit_day: "dia de edição do anúncio (parcial)",
  edited_within_period: "após edição do anúncio, sem reobservação",
  post_last_observation: "após a última sincronização",
  boundary_today: "hoje (dia parcial)",
  creative_swap_gap: "janela de troca de criativo",
  not_observed: "criativo não observado neste anúncio",
};

/** Rótulo do estado de confiança para a UI (nunca afirma "provado"). */
export const ATTRIBUTION_STATUS_LABEL: Record<AttributionStatus, string> = {
  FULLY_ATTRIBUTABLE: "Atribuição observada",
  PARTIALLY_ATTRIBUTABLE: "Atribuição parcial",
  UNATTRIBUTABLE: "Histórico não confirmado",
};
