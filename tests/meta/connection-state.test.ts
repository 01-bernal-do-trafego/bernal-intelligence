import { describe, expect, it } from "vitest";
import {
  META_UI_LABEL,
  META_UI_TONE,
  metaButtonLabel,
  metaIsUsable,
  metaNeedsAction,
  metaUiStateFromRow,
  parseMetaDbStatus,
  type MetaUiState,
} from "@/lib/meta/connection-state";

describe("metaUiStateFromRow", () => {
  it("sem linha => not_connected", () => {
    expect(metaUiStateFromRow(null)).toBe("not_connected");
    expect(metaUiStateFromRow(undefined)).toBe("not_connected");
  });

  it("linha sem segredo => reconnect (conexão iniciada, sem token)", () => {
    expect(
      metaUiStateFromRow({ status: "active", has_secret: false }),
    ).toBe("reconnect");
  });

  it("mapeia cada valor do enum do banco", () => {
    expect(metaUiStateFromRow({ status: "active", has_secret: true })).toBe(
      "connected",
    );
    expect(metaUiStateFromRow({ status: "expiring", has_secret: true })).toBe(
      "expiring",
    );
    expect(metaUiStateFromRow({ status: "expired", has_secret: true })).toBe(
      "expired",
    );
    expect(metaUiStateFromRow({ status: "revoked", has_secret: true })).toBe(
      "revoked",
    );
    expect(
      metaUiStateFromRow({
        status: "reauthorization_required",
        has_secret: true,
      }),
    ).toBe("reconnect");
  });

  it("status desconhecido => error", () => {
    expect(metaUiStateFromRow({ status: "banana", has_secret: true })).toBe(
      "error",
    );
  });
});

describe("parseMetaDbStatus", () => {
  it("valida contra o enum", () => {
    expect(parseMetaDbStatus("active")).toBe("active");
    expect(parseMetaDbStatus("reauthorization_required")).toBe(
      "reauthorization_required",
    );
    expect(parseMetaDbStatus("nope")).toBeNull();
    expect(parseMetaDbStatus(null)).toBeNull();
  });
});

const ALL_STATES: MetaUiState[] = [
  "not_connected",
  "connecting",
  "connected",
  "expiring",
  "expired",
  "revoked",
  "reconnect",
  "error",
];

describe("tabelas de UI", () => {
  it("todo estado tem label e tom", () => {
    for (const s of ALL_STATES) {
      expect(META_UI_LABEL[s]).toBeTruthy();
      expect(META_UI_TONE[s]).toBeTruthy();
    }
  });
});

describe("metaButtonLabel", () => {
  it("não conectado => Conectar; conectado/conectando => nenhum botão", () => {
    expect(metaButtonLabel("not_connected")).toBe("Conectar Meta Ads");
    expect(metaButtonLabel("connected")).toBeNull();
    expect(metaButtonLabel("connecting")).toBeNull();
  });

  it("demais estados => Reconectar", () => {
    for (const s of ["expiring", "expired", "revoked", "reconnect", "error"] as const) {
      expect(metaButtonLabel(s)).toBe("Reconectar Meta Ads");
    }
  });
});

describe("metaIsUsable / metaNeedsAction", () => {
  it("utilizável só quando conectado ou expirando", () => {
    expect(metaIsUsable("connected")).toBe(true);
    expect(metaIsUsable("expiring")).toBe(true);
    expect(metaIsUsable("expired")).toBe(false);
    expect(metaIsUsable("not_connected")).toBe(false);
  });

  it("precisa de ação nos estados quebrados / ausentes", () => {
    expect(metaNeedsAction("not_connected")).toBe(true);
    expect(metaNeedsAction("expired")).toBe(true);
    expect(metaNeedsAction("revoked")).toBe(true);
    expect(metaNeedsAction("reconnect")).toBe(true);
    expect(metaNeedsAction("error")).toBe(true);
    expect(metaNeedsAction("connected")).toBe(false);
    expect(metaNeedsAction("expiring")).toBe(false);
  });
});
