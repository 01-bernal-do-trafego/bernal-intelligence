/**
 * DATA V2.3A/V2.3B — Historical Backfill Rollout. Parsing de argumentos do
 * CLI. Módulo PURO — nenhum `process.argv`/`process.env` lido aqui, só a
 * função de parsing (testável com qualquer array).
 *
 * NUNCA aceita secret nenhum via argumento — só `--client-id`,
 * `--ad-account-ref`, `--from`, `--to`, `--levels`, `--execute`, `--resume`,
 * `--all-history`. Segredos vêm SOMENTE de env (ver `scripts/backfill/env.ts`).
 *
 * `--from`/`--to` OU `--all-history` — mutuamente exclusivos. Um dos dois é
 * obrigatório (fora do modo `--resume`):
 *   - `--from`/`--to`: intervalo EXPLÍCITO, sem discovery (V2.3A).
 *   - `--all-history`: dispara discovery (V2.3B) — `targetStartDate` só é
 *     conhecido depois da chamada ao `meta-backfill-discovery`, nunca aqui.
 * Sem nenhum dos dois, o runner recusa e explica (nunca inventa uma data,
 * preservando o contrato `targetStartDate=null -> requiresDiscovery` do
 * planner).
 */
import type { BackfillLevel } from "@/lib/backfill/types";

const VALID_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];
const DEFAULT_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];

export class CliArgsError extends Error {}

export type ParsedRunArgs =
  | {
      mode: "dry-run" | "execute";
      rangeMode: "explicit";
      clientId: string;
      adAccountRef: string;
      from: string;
      to: string;
      levels: readonly BackfillLevel[];
    }
  | {
      mode: "dry-run" | "execute";
      rangeMode: "all-history";
      clientId: string;
      adAccountRef: string;
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
  const allHistory = hasFlag(argv, "--all-history");
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

  if (allHistory && (from || to)) {
    throw new CliArgsError("--all-history e --from/--to são mutuamente exclusivos — escolha um dos dois.");
  }

  const mode = hasFlag(argv, "--execute") ? "execute" : "dry-run";

  if (allHistory) {
    return { mode, rangeMode: "all-history", clientId, adAccountRef, levels };
  }

  if (!from) {
    throw new CliArgsError(
      '--from (ou --all-history) é obrigatório. Sem nenhum dos dois, o runner nunca inventa uma data de início — use --all-history para descobrir automaticamente (DATA V2.3B) ou informe --from/--to explícitos.',
    );
  }
  if (!to) {
    throw new CliArgsError("--to é obrigatório junto de --from.");
  }

  return { mode, rangeMode: "explicit", clientId, adAccountRef, from, to, levels };
}
