import { describe, expect, it } from "vitest";
import {
  classifyAcquireError,
  manualHttpForResult,
  scheduledHttpForResult,
} from "@/lib/meta/sync-result-http";

describe("classifyAcquireError — skip esperado vs erro inesperado", () => {
  it("sync_already_running -> skip", () => {
    expect(classifyAcquireError({ message: "sync_already_running", code: "P0001" })).toEqual({
      reason: "sync_already_running",
      skip: true,
    });
  });
  it("no_eligible_account -> skip", () => {
    expect(classifyAcquireError({ message: "no_eligible_account", code: "P0001" })).toEqual({
      reason: "no_eligible_account",
      skip: true,
    });
  });
  it("erro desconhecido -> acquire_failed, NÃO skip, com phase e SQLSTATE", () => {
    expect(
      classifyAcquireError({ message: 'column reference "ad_account_ref" is ambiguous', code: "42702" }),
    ).toEqual({ reason: "acquire_failed", skip: false, phase: "acquire", code: "42702" });
  });
  it("sem code utilizável -> sem campo code", () => {
    expect(classifyAcquireError({ message: "boom", code: undefined })).toEqual({
      reason: "acquire_failed",
      skip: false,
      phase: "acquire",
    });
    expect(classifyAcquireError({ message: "boom", code: "not-a-sqlstate" }).code).toBeUndefined();
  });
  it("NUNCA propaga a message SQL bruta", () => {
    const out = classifyAcquireError({
      message: "ERROR: permission denied for table meta_connection_secrets; SELECT token_cipher ...",
      code: "42501",
    });
    expect(JSON.stringify(out)).not.toMatch(/token_cipher|permission denied|SELECT/i);
    expect(out).toEqual({ reason: "acquire_failed", skip: false, phase: "acquire", code: "42501" });
  });
});

describe("scheduledHttpForResult — meta-sync-scheduled", () => {
  it("ok -> 200 status:ok", () => {
    expect(scheduledHttpForResult({ ok: true })).toEqual({ status: 200, body: { status: "ok" } });
  });
  it("sync_already_running -> 200 skipped", () => {
    expect(
      scheduledHttpForResult({ ok: false, reason: "sync_already_running", skip: true }),
    ).toEqual({ status: 200, body: { status: "skipped", reason: "sync_already_running" } });
  });
  it("no_eligible_account -> 200 skipped", () => {
    expect(
      scheduledHttpForResult({ ok: false, reason: "no_eligible_account", skip: true }),
    ).toEqual({ status: 200, body: { status: "skipped", reason: "no_eligible_account" } });
  });
  it("acquire inesperado -> 500 status:error, sanitizado", () => {
    const out = scheduledHttpForResult({
      ok: false,
      reason: "acquire_failed",
      skip: false,
      phase: "acquire",
      code: "42702",
    });
    expect(out).toEqual({
      status: 500,
      body: { status: "error", reason: "acquire_failed", phase: "acquire", code: "42702" },
    });
  });
  it("erro inesperado sem code -> 500 sem code", () => {
    expect(
      scheduledHttpForResult({ ok: false, reason: "acquire_failed", skip: false, phase: "acquire" }),
    ).toEqual({
      status: 500,
      body: { status: "error", reason: "acquire_failed", phase: "acquire" },
    });
  });
});

describe("manualHttpForResult — meta-sync", () => {
  it("ok -> 200", () => {
    expect(manualHttpForResult({ ok: true }).status).toBe(200);
  });
  it("sync_already_running -> 409 erro real (não 200)", () => {
    expect(
      manualHttpForResult({ ok: false, reason: "sync_already_running", skip: true }),
    ).toEqual({ status: 409, body: { error: "sync_already_running" } });
  });
  it("no_eligible_account -> 409", () => {
    expect(
      manualHttpForResult({ ok: false, reason: "no_eligible_account", skip: true }).status,
    ).toBe(409);
  });
  it("acquire inesperado -> 500 erro real ao frontend, sanitizado", () => {
    const out = manualHttpForResult({
      ok: false,
      reason: "acquire_failed",
      skip: false,
      phase: "acquire",
      code: "42702",
    });
    expect(out).toEqual({
      status: 500,
      body: { error: "acquire_failed", phase: "acquire", code: "42702" },
    });
    expect(JSON.stringify(out.body)).not.toMatch(/select|token|secret|table/i);
  });
});
