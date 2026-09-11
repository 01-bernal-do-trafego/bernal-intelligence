/**
 * DATA FOUNDATION V2.1 — Query Layer. Anotação de `DataQuality`. Módulo PURO.
 *
 * Não altera `lib/data-quality.ts` (V2.0, checkpointado) — só COMPÕE em cima:
 * acrescenta motivos honestos (`reasons`) para indisponibilidades estruturais
 * da Query Layer (métrica desconhecida, nível incompatível, escopo não
 * consolidável, sem agregado periódico exato). Nunca inventa um `state` novo
 * — os únicos estados produzidos continuam sendo os da V2.0
 * (`ok | partial | stale | no_data`).
 */
import { emptyDataQuality, type DataQuality } from "@/lib/data-quality";

/** Acrescenta motivos a um `DataQuality` já produzido, sem trocar o `state`. */
export function annotateQuality(
  dq: DataQuality,
  extraReasons: readonly string[],
): DataQuality {
  if (extraReasons.length === 0) return dq;
  return { ...dq, reasons: [...dq.reasons, ...extraReasons] };
}

/**
 * `DataQuality` para uma indisponibilidade ESTRUTURAL (não é ausência de
 * sincronização — é uma pergunta que a fonte não pode responder: métrica
 * inexistente, nível incompatível, escopo multi-entidade não consolidável,
 * sem linha periódica exata). Estado `no_data` — é o mais honesto dos 4
 * produzidos hoje: não há valor a reportar.
 */
export function unavailableQuality(reason: string): DataQuality {
  return annotateQuality(emptyDataQuality(), [reason]);
}
