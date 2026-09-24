/**
 * DATA V2.3A/V2.3B + PROD SAFETY — Historical Backfill Rollout. Parsing de
 * argumentos do CLI. Módulo PURO — nenhum `process.argv`/`process.env` lido
 * aqui, só a função de parsing (testável com qualquer array).
 *
 * NUNCA aceita secret nenhum via argumento — só `--client-id`,
 * `--ad-account-ref`, `--from`, `--to`, `--levels`, `--execute`, `--resume`,
 * `--all-history`, `--environment`, `--confirm-project-ref`. Segredos vêm
 * SOMENTE de env (ver `scripts/backfill/env.ts`).
 *
 * `--environment` (`dev` | `prod`, default `dev` quando omitido — o
 * comportamento de hoje não muda) e `--confirm-project-ref` (só relevante
 * para `prod`) são repassados sem interpretação — quem decide se a
 * combinação é segura é `environment-guard.ts`, não este arquivo. Aqui só se
 * valida que `--environment`, quando informado, é literalmente "dev" ou
 * "prod" (nunca "production"/"staging"/etc.).
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
import type { Environment } from "./environment-guard";

const VALID_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];
const DEFAULT_LEVELS: readonly BackfillLevel[] = ["account", "campaign", "adset", "ad"];
const VALID_ENVIRONMENTS: readonly Environment[] = ["dev", "prod"];
const DEFAULT_ENVIRONMENT: Environment = "dev";

export class CliArgsError extends Error {}

export type ParsedRunArgs =
  | {
      mode: "dry-run" | "execute";
      rangeMode: "explicit";
      environment: Environment;
      confirmProjectRef: string | null;
      clientId: string;
      adAccountRef: string;
      from: string;
      to: string;
      levels: readonly BackfillLevel[];
    }
  | {
      mode: "dry-run" | "execute";
      rangeMode: "all-history";
      environment: Environment;
      confirmProjectRef: string | null;
      clientId: string;
      adAccountRef: string;
      levels: readonly BackfillLevel[];
    }
  | { mode: "resume"; environment: Environment; confirmProjectRef: string | null; jobId: string };

function getFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : null;
}
function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

/** `--environment` (default "dev" quando ausente) + `--confirm-project-ref`
 * (repassado cru — a validação de valor é de `environment-guard.ts`). Lança
 * `CliArgsError` só se `--environment` vier com um valor que não seja
 * literalmente "dev" ou "prod". */
function parseEnvironmentFlags(
  argv: readonly string[],
): { environment: Environment; confirmProjectRef: string | null } {
  const raw = getFlagValue(argv, "--environment");
  const confirmProjectRef = getFlagValue(argv, "--confirm-project-ref");
  if (raw === null) {
    return { environment: DEFAULT_ENVIRONMENT, confirmProjectRef };
  }
  if (!VALID_ENVIRONMENTS.includes(raw as Environment)) {
    throw new CliArgsError(
      `--environment inválido: "${raw}" (esperado "dev" ou "prod" — nenhum outro ambiente existe nesta arquitetura)`,
    );
  }
  return { environment: raw as Environment, confirmProjectRef };
}

/** Parseia `process.argv.slice(2)` (ou qualquer array equivalente, em teste). Lança `CliArgsError` em payload inválido. */
export function parseRunArgs(argv: readonly string[]): ParsedRunArgs {
  const resumeJobId = getFlagValue(argv, "--resume");
  if (resumeJobId) {
    const { environment, confirmProjectRef } = parseEnvironmentFlags(argv);
    return { mode: "resume", environment, confirmProjectRef, jobId: resumeJobId };
  }

  const clientId = getFlagValue(argv, "--client-id");
  const adAccountRef = getFlagValue(argv, "--ad-account-ref");
  const from = getFlagValue(argv, "--from");
  const to = getFlagValue(argv, "--to");
  const allHistory = hasFlag(argv, "--all-history");
  const levelsRaw = getFlagValue(argv, "--levels");
  const levels = (levelsRaw ? levelsRaw.split(",").map((s) => s.trim()) : [...DEFAULT_LEVELS]) as BackfillLevel[];
  const { environment, confirmProjectRef } = parseEnvironmentFlags(argv);

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
    return { mode, rangeMode: "all-history", environment, confirmProjectRef, clientId, adAccountRef, levels };
  }

  if (!from) {
    throw new CliArgsError(
      '--from (ou --all-history) é obrigatório. Sem nenhum dos dois, o runner nunca inventa uma data de início — use --all-history para descobrir automaticamente (DATA V2.3B) ou informe --from/--to explícitos.',
    );
  }
  if (!to) {
    throw new CliArgsError("--to é obrigatório junto de --from.");
  }

  return { mode, rangeMode: "explicit", environment, confirmProjectRef, clientId, adAccountRef, from, to, levels };
}
