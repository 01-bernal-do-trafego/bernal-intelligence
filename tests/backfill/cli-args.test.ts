import { describe, expect, it } from "vitest";
import { CliArgsError, parseRunArgs } from "../../scripts/backfill/cli-args";

const BASE = ["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"];
const BASE_ALL_HISTORY = ["--client-id", "c1", "--ad-account-ref", "a1", "--all-history"];

describe("parseRunArgs — modo padrão é dry-run", () => {
  it("sem --execute -> mode dry-run", () => {
    const parsed = parseRunArgs(BASE);
    expect(parsed.mode).toBe("dry-run");
  });
  it("com --execute -> mode execute", () => {
    const parsed = parseRunArgs([...BASE, "--execute"]);
    expect(parsed.mode).toBe("execute");
  });
});

describe("parseRunArgs — rangeMode explicit (--from/--to)", () => {
  it("--from/--to -> rangeMode explicit", () => {
    const parsed = parseRunArgs(BASE);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.rangeMode).toBe("explicit");
  });
  it("sem --from e sem --all-history -> CliArgsError explicando as duas opções", () => {
    expect(() => parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--to", "2026-08-31"])).toThrow(
      CliArgsError,
    );
    try {
      parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--to", "2026-08-31"]);
    } catch (e) {
      expect((e as Error).message).toMatch(/--all-history/);
    }
  });
  it("sem --to -> CliArgsError", () => {
    expect(() => parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01"])).toThrow(
      CliArgsError,
    );
  });
});

describe("parseRunArgs — rangeMode all-history (--all-history)", () => {
  it("--all-history -> rangeMode all-history, sem from/to", () => {
    const parsed = parseRunArgs(BASE_ALL_HISTORY);
    expect(parsed).toEqual({
      mode: "dry-run",
      rangeMode: "all-history",
      environment: "dev",
      confirmProjectRef: null,
      clientId: "c1",
      adAccountRef: "a1",
      levels: ["account", "campaign", "adset", "ad"],
    });
  });
  it("--all-history --execute -> mode execute, rangeMode all-history", () => {
    const parsed = parseRunArgs([...BASE_ALL_HISTORY, "--execute"]);
    expect(parsed.mode).toBe("execute");
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.rangeMode).toBe("all-history");
  });
});

describe("parseRunArgs — --all-history e --from/--to são mutuamente exclusivos", () => {
  it("--all-history + --from -> CliArgsError", () => {
    expect(() => parseRunArgs([...BASE_ALL_HISTORY, "--from", "2026-08-01"])).toThrow(CliArgsError);
  });
  it("--all-history + --to -> CliArgsError", () => {
    expect(() => parseRunArgs([...BASE_ALL_HISTORY, "--to", "2026-08-31"])).toThrow(CliArgsError);
  });
  it("--all-history + --from + --to -> CliArgsError, mensagem menciona mutuamente exclusivos", () => {
    try {
      parseRunArgs([...BASE_ALL_HISTORY, "--from", "2026-08-01", "--to", "2026-08-31"]);
      throw new Error("deveria ter lançado");
    } catch (e) {
      expect(e).toBeInstanceOf(CliArgsError);
      expect((e as Error).message).toMatch(/mutuamente exclusiv/);
    }
  });
});

describe("parseRunArgs — --client-id/--ad-account-ref obrigatórios (fora de --resume)", () => {
  it("sem --client-id -> CliArgsError", () => {
    expect(() => parseRunArgs(["--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"])).toThrow(
      CliArgsError,
    );
  });
  it("sem --client-id, mesmo com --all-history -> CliArgsError", () => {
    expect(() => parseRunArgs(["--ad-account-ref", "a1", "--all-history"])).toThrow(CliArgsError);
  });
});

describe("parseRunArgs — --levels", () => {
  it("default = account,campaign,adset,ad quando omitido", () => {
    const parsed = parseRunArgs(BASE);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.levels).toEqual(["account", "campaign", "adset", "ad"]);
  });
  it("aceita lista custom", () => {
    const parsed = parseRunArgs([...BASE, "--levels", "account,campaign"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.levels).toEqual(["account", "campaign"]);
  });
  it("level inválido -> CliArgsError", () => {
    expect(() => parseRunArgs([...BASE, "--levels", "account,invalido"])).toThrow(CliArgsError);
  });
  it("--levels funciona também com --all-history", () => {
    const parsed = parseRunArgs([...BASE_ALL_HISTORY, "--levels", "account"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.levels).toEqual(["account"]);
  });
});

describe("parseRunArgs — --resume não exige nada além do jobId", () => {
  it("--resume <jobId> -> mode resume, ignora client-id/from/to/all-history mesmo se ausentes", () => {
    const parsed = parseRunArgs(["--resume", "job-123"]);
    expect(parsed).toEqual({ mode: "resume", environment: "dev", confirmProjectRef: null, jobId: "job-123" });
  });
  it("--resume tem prioridade mesmo se outras flags também vierem", () => {
    const parsed = parseRunArgs(["--resume", "job-123", "--client-id", "c1"]);
    expect(parsed.mode).toBe("resume");
  });
  it("--resume nunca dispara discovery — não roda nenhuma checagem de rangeMode", () => {
    const parsed = parseRunArgs(["--resume", "job-123", "--all-history"]);
    expect(parsed).toEqual({ mode: "resume", environment: "dev", confirmProjectRef: null, jobId: "job-123" });
  });
});

describe("nenhum secret é um flag reconhecido (nunca aceito via CLI)", () => {
  it("uma flag de secret não declarada não quebra nem é lida — parseRunArgs só conhece os flags documentados", () => {
    const parsed = parseRunArgs([...BASE, "--secret", "abc123"]);
    expect(parsed.mode).toBe("dry-run");
    expect(JSON.stringify(parsed)).not.toContain("abc123");
  });
});

/* ================= PROD SAFETY — --environment / --confirm-project-ref ================= */

describe("parseRunArgs — --environment (default dev, só dev/prod aceitos)", () => {
  it("sem --environment -> environment: 'dev' (comportamento padrão inalterado)", () => {
    const parsed = parseRunArgs(BASE);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.environment).toBe("dev");
    expect(parsed.confirmProjectRef).toBeNull();
  });

  it("--environment dev explícito -> environment: 'dev'", () => {
    const parsed = parseRunArgs([...BASE, "--environment", "dev"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.environment).toBe("dev");
  });

  it("--environment prod -> environment: 'prod'", () => {
    const parsed = parseRunArgs([...BASE, "--environment", "prod"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.environment).toBe("prod");
  });

  it("--environment com valor desconhecido -> CliArgsError, nunca 'aceita por padrão'", () => {
    expect(() => parseRunArgs([...BASE, "--environment", "staging"])).toThrow(CliArgsError);
    expect(() => parseRunArgs([...BASE, "--environment", "production"])).toThrow(CliArgsError);
    expect(() => parseRunArgs([...BASE, "--environment", "PROD"])).toThrow(CliArgsError); // case-sensitive, sem normalização silenciosa
  });

  it("--confirm-project-ref é repassado cru, sem validar o valor aqui (validação é do environment-guard)", () => {
    const parsed = parseRunArgs([...BASE, "--environment", "prod", "--confirm-project-ref", "qualquer-coisa"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.confirmProjectRef).toBe("qualquer-coisa");
  });

  it("--confirm-project-ref sem --environment (dev implícito) -> ainda é lido/repassado, mesmo sem uso (dev ignora)", () => {
    const parsed = parseRunArgs([...BASE, "--confirm-project-ref", "bmtzurlsohinqbjxcpje"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.environment).toBe("dev");
    expect(parsed.confirmProjectRef).toBe("bmtzurlsohinqbjxcpje");
  });

  it("--environment funciona também com --all-history", () => {
    const parsed = parseRunArgs([...BASE_ALL_HISTORY, "--environment", "prod", "--confirm-project-ref", "x"]);
    if (parsed.mode === "resume") throw new Error("não deveria ser resume");
    expect(parsed.environment).toBe("prod");
  });

  it("--resume também aceita --environment/--confirm-project-ref (resume em Prod passa pelo mesmo contrato)", () => {
    const parsed = parseRunArgs(["--resume", "job-1", "--environment", "prod", "--confirm-project-ref", "bmtzurlsohinqbjxcpje"]);
    expect(parsed).toEqual({
      mode: "resume",
      environment: "prod",
      confirmProjectRef: "bmtzurlsohinqbjxcpje",
      jobId: "job-1",
    });
  });
});
