import { describe, expect, it } from "vitest";
import { CliArgsError, parseRunArgs } from "../../scripts/backfill/cli-args";

const BASE = ["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"];

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

describe("parseRunArgs — --from é obrigatório (discovery é a V2.3B)", () => {
  it("sem --from -> CliArgsError explicando discovery", () => {
    expect(() => parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--to", "2026-08-31"])).toThrow(
      CliArgsError,
    );
    try {
      parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--to", "2026-08-31"]);
    } catch (e) {
      expect((e as Error).message).toMatch(/discovery/i);
      expect((e as Error).message).toMatch(/V2\.3B/);
    }
  });
  it("sem --to -> CliArgsError", () => {
    expect(() => parseRunArgs(["--client-id", "c1", "--ad-account-ref", "a1", "--from", "2026-08-01"])).toThrow(
      CliArgsError,
    );
  });
});

describe("parseRunArgs — --client-id/--ad-account-ref obrigatórios (fora de --resume)", () => {
  it("sem --client-id -> CliArgsError", () => {
    expect(() => parseRunArgs(["--ad-account-ref", "a1", "--from", "2026-08-01", "--to", "2026-08-31"])).toThrow(
      CliArgsError,
    );
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
});

describe("parseRunArgs — --resume não exige nada além do jobId", () => {
  it("--resume <jobId> -> mode resume, ignora client-id/from/to mesmo se ausentes", () => {
    const parsed = parseRunArgs(["--resume", "job-123"]);
    expect(parsed).toEqual({ mode: "resume", jobId: "job-123" });
  });
  it("--resume tem prioridade mesmo se outras flags também vierem", () => {
    const parsed = parseRunArgs(["--resume", "job-123", "--client-id", "c1"]);
    expect(parsed.mode).toBe("resume");
  });
});

describe("nenhum secret é um flag reconhecido (nunca aceito via CLI)", () => {
  it("uma flag de secret não declarada não quebra nem é lida — parseRunArgs só conhece os flags documentados", () => {
    const parsed = parseRunArgs([...BASE, "--secret", "abc123"]);
    expect(parsed.mode).toBe("dry-run");
    expect(JSON.stringify(parsed)).not.toContain("abc123");
  });
});
