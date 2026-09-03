import { describe, expect, it } from "vitest";
import { isClientDueForSync, type DueForSyncInput } from "@/lib/meta/due-for-sync";

const NOW = Date.parse("2026-09-03T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const base: DueForSyncInput = {
  performanceSyncedAt: hoursAgo(6), // velho (> 4h)
  lastAttemptStartedAt: null, // nenhuma tentativa recente
  hasRecentRunningRun: false,
  now: NOW,
};

describe("isClientDueForSync — dispatcher (cooldown de retry)", () => {
  it("due sem tentativa recente -> SELECIONADO", () => {
    expect(isClientDueForSync(base)).toBe(true);
  });

  it("performance nunca sincronizada, sem tentativa -> SELECIONADO", () => {
    expect(isClientDueForSync({ ...base, performanceSyncedAt: null })).toBe(true);
  });

  it("success recente (< 4h) -> NÃO due (performance fresca)", () => {
    expect(isClientDueForSync({ ...base, performanceSyncedAt: hoursAgo(2) })).toBe(false);
  });

  it("falha recente há 1h (performance continua velha) -> NÃO selecionado (cooldown)", () => {
    // cenário do bug: 12:00 due -> sync roda -> 12:01 falha -> 12:15 dispatcher
    expect(
      isClientDueForSync({
        ...base,
        performanceSyncedAt: hoursAgo(6), // não mudou (tentativa falha não envelhece)
        lastAttemptStartedAt: hoursAgo(1),
      }),
    ).toBe(false);
  });

  it("NENHUM retry a cada 15 min após falha: tentativa há 15/30/60/180 min -> sempre bloqueado", () => {
    for (const mins of [15, 30, 60, 120, 180, 239]) {
      expect(
        isClientDueForSync({
          ...base,
          lastAttemptStartedAt: new Date(NOW - mins * 60_000).toISOString(),
        }),
      ).toBe(false);
    }
  });

  it("após o cooldown (tentativa há > 4h) e performance ainda velha -> SELECIONADO de novo", () => {
    expect(
      isClientDueForSync({
        ...base,
        performanceSyncedAt: hoursAgo(9),
        lastAttemptStartedAt: hoursAgo(4.5),
      }),
    ).toBe(true);
  });

  it("run `running` recente -> NÃO selecionado (guard de concorrência)", () => {
    expect(isClientDueForSync({ ...base, hasRecentRunningRun: true })).toBe(false);
  });

  it("cooldown e minAge são parametrizáveis", () => {
    // cooldown de 1h: tentativa há 90 min já não bloqueia
    expect(
      isClientDueForSync({
        ...base,
        lastAttemptStartedAt: new Date(NOW - 90 * 60_000).toISOString(),
        retryCooldownMs: 60 * 60_000,
      }),
    ).toBe(true);
    // minAge de 8h: performance de 6h ainda é fresca
    expect(
      isClientDueForSync({ ...base, performanceSyncedAt: hoursAgo(6), minAgeMs: 8 * 3_600_000 }),
    ).toBe(false);
  });

  it("caminho MANUAL é independente: a função não é consultada nele (documental)", () => {
    // manual chama runClientSync direto; mesmo com cooldown ativo o usuário
    // sincroniza. Aqui só garantimos que a regra do dispatcher não 'sabe' de
    // trigger — qualquer tentativa recente conta, inclusive uma manual.
    expect(
      isClientDueForSync({ ...base, lastAttemptStartedAt: hoursAgo(0.5) }),
    ).toBe(false);
  });
});
