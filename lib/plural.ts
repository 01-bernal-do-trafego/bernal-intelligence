/**
 * Pluralização simples pt-BR. `many` opcional — default é `singular + "s"`
 * (cobre "cliente/clientes", "conta/contas", "atualizado/atualizados"; casos
 * irregulares como "precisa/precisam" passam o `many` explícito).
 */
export function plural(count: number, singular: string, many?: string): string {
  return count === 1 ? singular : (many ?? `${singular}s`);
}

/** `"1 cliente"`, `"2 clientes"` — número + palavra flexionada. */
export function pluralize(count: number, singular: string, many?: string): string {
  return `${count} ${plural(count, singular, many)}`;
}
