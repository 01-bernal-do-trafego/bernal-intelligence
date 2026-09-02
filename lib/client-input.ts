import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/types/domain";

/**
 * Validação/normalização pura da entrada de cliente. Compartilhada por
 * criação e edição (e testada isoladamente). A regra final de nome não-vazio
 * também existe no banco (`check (length(btrim(name)) > 0)`).
 */

export interface ClientInput {
  name: string;
  internalName: string;
  status: string;
}

export interface ParsedClientInput {
  name: string;
  internalName: string | null;
  status: ClientStatus;
}

export type ParseClientResult =
  | { ok: true; value: ParsedClientInput }
  | { ok: false; error: string };

const VALID_STATUS = new Set<string>(Object.keys(CLIENT_STATUS_LABEL));

export const MAX_NAME_LENGTH = 120;

/** Arquivar um cliente = mudar o status para 'archived' (nunca apagar). */
export const ARCHIVE_STATUS: ClientStatus = "archived";

export function parseClientInput(input: ClientInput): ParseClientResult {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, error: "Informe o nome do cliente." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Nome muito longo (máximo ${MAX_NAME_LENGTH} caracteres).`,
    };
  }
  if (!VALID_STATUS.has(input.status)) {
    return { ok: false, error: "Status inválido." };
  }

  const internalName = input.internalName.trim();
  return {
    ok: true,
    value: {
      name,
      internalName: internalName.length > 0 ? internalName : null,
      status: input.status as ClientStatus,
    },
  };
}
