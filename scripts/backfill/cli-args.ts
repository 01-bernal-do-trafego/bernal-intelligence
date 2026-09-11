/**
 * DATA V2.3A — Historical Backfill Rollout. Parsing de argumentos do CLI.
 * Módulo PURO — nenhum `process.argv`/`process.env` lido aqui, só a função
 * de parsing (testável com qualquer array).
 *
 * NUNCA aceita secret nenhum via argumento — só `--client-id`,
 * `--ad-account-ref`, `--from`, `--to`, `--levels`, `--execute`, `--resume`.
 * Segredos vêm SOMENTE de env (ver `scripts/backfill/env.ts`).
 *
 * `--from`/`--to` são OBRIGATÓRIOS (fora do modo `--resume`) — discovery
 * ("todo o histórico disponível pela fonte") é a DATA V2.3B, ainda não
 * implementada. Sem `--from`, o runner recusa explicitamente (nunca inventa
 * uma data), preservando o contrato de `targetStartDate=null ->
 * requiresDiscovery` do planner.
 */
import type { BackfillLevel } from "@/lib/backfill/types";

const VALID_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];
const DEFAULT_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];

export class CliArgsError extends Error {}

export type ParsedRunArgs =
  | {
      mode: "dry-run" | "execute";
      clientId: string;
      adAccountRef: string;
      from: string;
      to: string;
      levels: readonly BackfillLevel[];
    }
  | { mode: "resume"; jobId: string };

function getFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : null;
}
function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

/** Parseia `process.argv.slice(2)` (ou qualquer array equivalente, em teste). Lança `CliArgsError` em payload inválido. */
export function parseRunArgs(argv: readonly string[]): ParsedRunArgs {
  const resumeJobId = getFlagValue(argv, "--resume");
  if (resumeJobId) {
    return { mode: "resume", jobId: resumeJobId };
  }

  const clientId = getFlagValue(argv, "--client-id");
  const adAccountRef = getFlagValue(argv, "--ad-account-ref");
  const from = getFlagValue(argv, "--from");
  const to = getFlagValue(argv, "--to");
  const levelsRaw = getFlagValue(argv, "--levels");
  const levels = (levelsRaw ? levelsRaw.split(",").map((s) => s.trim()) : [...DEFAULT_LEVELS]) as BackfillLevel[];

  for (const l of levels) {
    if (!VALID_LEVELS.includes(l)) {
      throw new CliArgsError(`--levels inválido: "${l}" (esperado account,campaign,adset,ad)`);
    }
  }
  if (!clientId || !adAccountRef) {
    throw new CliArgsError("--client-id e --ad-account-ref são obrigatórios");
  }
  if (!from) {
    throw new CliArgsError(
      '--from é obrigatório nesta etapa. Discovery ("todo o histórico disponível pela fonte") é a DATA V2.3B, ainda não implementada — o runner nunca inventa uma data de início.',
    );
  }
  if (!to) {
    throw new CliArgsError("--to é obrigatório nesta etapa.");
  }

  return {
    mode: hasFlag(argv, "--execute") ? "execute" : "dry-run",
    clientId,
    adAccountRef,
    from,
    to,
    levels,
  };
}
