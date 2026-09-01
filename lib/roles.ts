/**
 * Papéis de usuário — espelho do enum `user_role` do banco.
 * Módulo puro (sem Supabase, sem server-only): pode ser usado no cliente.
 */
export type AppRole = "agency_admin" | "agency_member" | "client_user";

export const APP_ROLES: readonly AppRole[] = [
  "agency_admin",
  "agency_member",
  "client_user",
];

/** Papéis da equipe Bernal, com acesso ao painel administrativo. */
export function isAgencyRole(role: AppRole | null | undefined): boolean {
  return role === "agency_admin" || role === "agency_member";
}

/** Converte um valor desconhecido (ex.: vindo do banco) em AppRole válido. */
export function parseRole(value: unknown): AppRole | null {
  return value === "agency_admin" ||
    value === "agency_member" ||
    value === "client_user"
    ? value
    : null;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  agency_admin: "Administrador",
  agency_member: "Equipe",
  client_user: "Cliente",
};
