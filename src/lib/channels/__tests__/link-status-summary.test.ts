import { describe, expect, it } from "vitest";
import { agoLabel, summarizeLinkStatus, type LinkStatusInput } from "../link-status-summary";

const now = new Date("2026-11-19T14:20:00Z"); // 11:20 en Córdoba
const none = { toBlock: [], toRelease: [] };

const link = (over: Partial<LinkStatusInput> = {}): LinkStatusInput => ({
  id: "l1",
  channel: "airbnb",
  status: "active",
  unit: { id: "u1", code: "SAL648", name: "SALGUERO II" },
  health_state: "healthy",
  feed_secret_id: "s1",
  last_success_at: "2026-11-19T14:17:00Z",
  consecutive_failures: 0,
  last_export_access_at: "2026-11-19T11:52:51Z",
  export_interval_min: 180,
  health: { last_events: 0 },
  publication: { kind: "ok", nextReadAt: "2026-11-19T14:52:51.000Z", changes: none },
  open_issues: 0,
  ...over,
});

describe("summarizeLinkStatus", () => {
  // El reclamo de Apart CBA del 19/11/2026: cierre cargado a las 11:15.
  it("dice qué le falta leer a la OTA y a qué hora lo va a ver", () => {
    const s = summarizeLinkStatus(
      link({
        publication: {
          kind: "pending",
          nextReadAt: "2026-11-19T14:52:51.000Z",
          changes: { toBlock: [["2026-11-22", "2026-11-24"]], toRelease: [] },
        },
      }),
      now,
    );
    expect(s.unidad).toBe("SAL648 · SALGUERO II");
    expect(s.publicacion).toBe(
      "Airbnb leyó hace 2 h y todavía no vio un cambio; lo ve a eso de las 11:52.",
    );
    expect(s.le_falta_cerrar).toEqual(["22/11 → 24/11"]);
    expect(s.como_forzar).toContain("Airbnb");
    expect(s.needsAttention).toBe(true);
    // «Conectada» sola hacía pensar que ya estaba: se pinta como algo a mirar.
    expect(s.tone).toBe("warn");
  });

  it("al día: lo dice, con el ritmo, y no pide atención", () => {
    const s = summarizeLinkStatus(link(), now);
    expect(s.publicacion).toBe("Airbnb está al día: leyó hace 2 h y lee cada 3 h.");
    expect(s.recepcion).toBe("Sus reservas se leen bien (hace 3 min); hoy su calendario no trae ninguna.");
    expect(s.como_forzar).toBeNull();
    expect(s.needsAttention).toBe(false);
    expect(s.tone).toBe("good");
  });

  // JARDINES (Viaggiato): figuraba «Conectada».
  it("una OTA que dejó de leer", () => {
    const s = summarizeLinkStatus(
      link({
        health_state: "unread",
        last_export_access_at: "2026-11-06T18:38:06Z",
        publication: { kind: "stale", nextReadAt: null, changes: none },
      }),
      now,
    );
    expect(s.estado).toBe("La OTA no lee");
    expect(s.publicacion).toContain("no lee tu calendario desde hace 13 días");
    expect(s.needsAttention).toBe(true);
  });

  // CENTRO (Viaggiato): HTTP 400 desde el 18/11.
  it("un calendario de la OTA que no se puede leer", () => {
    const s = summarizeLinkStatus(
      link({
        channel: "booking",
        health_state: "critical",
        consecutive_failures: 29,
        health: { last_error: "HTTP 400" },
      }),
      now,
    );
    expect(s.recepcion).toBe(
      "No se puede leer el calendario de Booking: 29 intentos fallidos seguidos (HTTP 400). Sus reservas no están entrando.",
    );
    expect(s.tone).toBe("bad");
  });

  it("en pausa", () => {
    const s = summarizeLinkStatus(link({ status: "paused", health_state: "paused", publication: null }), now);
    expect(s.publicacion).toBe("La conexión está en pausa.");
    expect(s.needsAttention).toBe(false);
  });
});

describe("agoLabel", () => {
  it.each([
    ["2026-11-19T14:19:30Z", "recién"],
    ["2026-11-19T13:35:00Z", "hace 45 min"],
    ["2026-11-19T08:20:00Z", "hace 6 h"],
    ["2026-11-06T14:20:00Z", "hace 13 días"],
  ])("%s → %s", (iso, label) => {
    expect(agoLabel(iso, now)).toBe(label);
  });
});
