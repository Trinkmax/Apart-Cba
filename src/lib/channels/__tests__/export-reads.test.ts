import { describe, expect, it } from "vitest";
import {
  attributeUnitRead,
  futureStays,
  intervalLabel,
  pendingChanges,
  publicationState,
  readerFromUserAgent,
  stayLabel,
  typicalIntervalMin,
  type AttributableLink,
  type Stay,
} from "../export-reads";

const today = "2026-11-19";
const at = (iso: string) => Date.parse(iso);

describe("readerFromUserAgent", () => {
  it("reconoce a quien se identifica", () => {
    expect(readerFromUserAgent("Airbnb Calendar Importer")).toBe("airbnb");
    expect(readerFromUserAgent("Mozilla/5.0 (compatible; Booking.com iCal)")).toBe("booking");
  });

  it("lo que no reconoce queda sin atribuir", () => {
    expect(readerFromUserAgent("Mozilla/5.0")).toBe("unknown");
    expect(readerFromUserAgent(null)).toBe("unknown");
  });
});

describe("attributeUnitRead", () => {
  const now = at("2026-11-19T14:52:25Z");
  const airbnb: AttributableLink = {
    id: "airbnb",
    channel: "airbnb",
    status: "active",
    export_via: "unit",
    last_export_access_at: "2026-11-19T11:52:51Z",
  };
  const booking: AttributableLink = {
    id: "booking",
    channel: "booking",
    status: "active",
    export_via: "link",
    last_export_access_at: "2026-11-19T13:03:39Z",
  };

  // SAL648: Booking lee por su dirección propia, así que la vieja es de Airbnb.
  it("no le anota la lectura a la conexión que lee por su propia dirección", () => {
    expect(attributeUnitRead([airbnb, booking], "unknown", now)).toEqual(["airbnb"]);
  });

  it("si quien lee se identifica, va a su canal aunque el otro también use la vieja", () => {
    const bookingOld = { ...booking, export_via: "unit" as const };
    expect(attributeUnitRead([airbnb, bookingOld], "booking", now)).toEqual(["booking"]);
  });

  it("sin forma de saberlo, a las dos", () => {
    const bookingOld = { ...booking, export_via: null };
    expect(attributeUnitRead([airbnb, bookingOld], "unknown", now)).toEqual(["airbnb", "booking"]);
  });

  it("una conexión que dejó de leer por la suya hace días vuelve a contar", () => {
    const quiet = { ...booking, last_export_access_at: "2026-11-10T13:03:39Z" };
    expect(attributeUnitRead([airbnb, quiet], "unknown", now)).toEqual(["airbnb", "booking"]);
  });

  it("los borradores no leen nada", () => {
    const draft = { ...booking, status: "draft", export_via: null };
    expect(attributeUnitRead([airbnb, draft], "unknown", now)).toEqual(["airbnb"]);
  });

  it("si se identifica un canal sin conexión en el departamento, no se pierde la lectura", () => {
    expect(attributeUnitRead([airbnb], "booking", now)).toEqual(["airbnb"]);
  });
});

describe("futureStays", () => {
  it("deja lo que todavía bloquea, ordenado y sin repetir", () => {
    const stays: Stay[] = [
      ["2026-11-22", "2026-11-24"],
      ["2026-11-12", "2026-11-14"], // ya pasó
      ["2026-11-17", "2026-11-22"],
      ["2026-11-22", "2026-11-24"],
    ];
    expect(futureStays(stays, today)).toEqual([
      ["2026-11-17", "2026-11-22"],
      ["2026-11-22", "2026-11-24"],
    ]);
  });

  it("la que sale hoy ya no bloquea ninguna noche", () => {
    expect(futureStays([["2026-11-17", "2026-11-19"]], today)).toEqual([]);
  });
});

describe("pendingChanges", () => {
  const lucia: Stay = ["2026-11-17", "2026-11-22"];
  const sucio: Stay = ["2026-11-22", "2026-11-24"];
  const dic: Stay = ["2026-12-04", "2026-12-07"];

  // SAL648, 19/11/2026 11:15: se carga el cierre 22→24; Airbnb leyó a las 08:52.
  it("lo que se cargó después de la última lectura está por bloquearse", () => {
    expect(pendingChanges([lucia, sucio, dic], [lucia, dic], today)).toEqual({
      toBlock: [sucio],
      toRelease: [],
    });
  });

  it("lo que se canceló después sigue cerrado en la OTA", () => {
    expect(pendingChanges([lucia, sucio], [lucia, sucio, dic], today)).toEqual({
      toBlock: [],
      toRelease: [dic],
    });
  });

  it("al día: nada pendiente", () => {
    expect(pendingChanges([lucia, sucio], [lucia, sucio], today)).toEqual({
      toBlock: [],
      toRelease: [],
    });
  });

  it("partir una estadía en dos tramos con las mismas noches no es un cambio", () => {
    const entera: Stay = ["2026-12-01", "2026-12-10"];
    const tramos: Stay[] = [
      ["2026-12-01", "2026-12-05"],
      ["2026-12-05", "2026-12-10"],
    ];
    expect(pendingChanges(tramos, [entera], today)).toEqual({ toBlock: [], toRelease: [] });
  });

  it("extender una estadía deja pendientes sólo las noches nuevas", () => {
    expect(
      pendingChanges([["2026-12-04", "2026-12-09"]], [["2026-12-04", "2026-12-07"]], today),
    ).toEqual({ toBlock: [["2026-12-07", "2026-12-09"]], toRelease: [] });
  });

  it("las noches que ya pasaron no cuentan", () => {
    expect(
      pendingChanges([["2026-11-10", "2026-11-22"]], [["2026-11-17", "2026-11-22"]], today),
    ).toEqual({ toBlock: [], toRelease: [] });
  });

  it("sin lectura registrada no inventa nada", () => {
    expect(pendingChanges([lucia, sucio], null, today)).toEqual({ toBlock: [], toRelease: [] });
  });
});

describe("typicalIntervalMin", () => {
  it("Airbnb: cada tres horas", () => {
    const reads = [
      "2026-11-18T17:51:52Z",
      "2026-11-18T20:52:30Z",
      "2026-11-18T23:52:32Z",
      "2026-11-19T02:52:34Z",
      "2026-11-19T04:55:48Z",
      "2026-11-19T09:00:04Z",
      "2026-11-19T11:52:51Z",
      "2026-11-19T14:52:25Z",
    ];
    expect(typicalIntervalMin(reads)).toBe(180);
  });

  it("dos pedidos seguidos cuentan como una lectura", () => {
    const reads = [
      "2026-11-19T04:05:36Z",
      "2026-11-19T06:20:43Z",
      "2026-11-19T06:20:46Z",
      "2026-11-19T08:30:39Z",
      "2026-11-19T10:47:45Z",
    ];
    const interval = typicalIntervalMin(reads)!;
    expect(interval).toBeGreaterThan(125);
    expect(interval).toBeLessThan(140);
  });

  it("con dos lecturas todavía no hay un ritmo", () => {
    expect(typicalIntervalMin(["2026-11-19T11:52:51Z", "2026-11-19T14:52:25Z"])).toBeNull();
  });
});

describe("publicationState", () => {
  const none = { toBlock: [], toRelease: [] };
  const now = at("2026-11-19T14:20:00Z");

  it("leyó hace poco y vio todo", () => {
    const s = publicationState(
      { lastReadAt: "2026-11-19T11:52:51Z", intervalMin: 180, activeSince: "2026-07-17T00:00:00Z", changes: none },
      now,
    );
    expect(s.kind).toBe("ok");
    expect(s.nextReadAt).toBe("2026-11-19T14:52:51.000Z");
  });

  it("hay un cambio que todavía no vio, y se sabe cuándo lo va a ver", () => {
    const s = publicationState(
      {
        lastReadAt: "2026-11-19T11:52:51Z",
        intervalMin: 180,
        activeSince: "2026-07-17T00:00:00Z",
        changes: { toBlock: [["2026-11-22", "2026-11-24"]], toRelease: [] },
      },
      now,
    );
    expect(s.kind).toBe("pending");
    expect(s.nextReadAt).toBe("2026-11-19T14:52:51.000Z");
  });

  it("si ya tendría que haber leído, no promete una hora que pasó", () => {
    const s = publicationState(
      { lastReadAt: "2026-11-19T09:00:00Z", intervalMin: 180, activeSince: "2026-07-17T00:00:00Z", changes: none },
      now,
    );
    expect(s.nextReadAt).toBeNull();
  });

  // JARDINES (Viaggiato): Airbnb no lee desde el 06/11 y figuraba «Conectada».
  it("una OTA que dejó de leer no está al día", () => {
    const s = publicationState(
      { lastReadAt: "2026-11-06T18:38:06Z", intervalMin: 180, activeSince: "2026-10-28T00:00:00Z", changes: none },
      now,
    );
    expect(s.kind).toBe("stale");
  });

  // CARLUCCI y FRIAS: tres semanas en «Esperando verificación».
  it("nunca leyó y ya pasó el margen", () => {
    const s = publicationState(
      { lastReadAt: null, intervalMin: null, activeSince: "2026-10-28T00:00:00Z", changes: none },
      now,
    );
    expect(s.kind).toBe("never");
  });

  it("recién conectada: todavía puede estar por leer", () => {
    const s = publicationState(
      { lastReadAt: null, intervalMin: null, activeSince: "2026-11-19T10:00:00Z", changes: none },
      now,
    );
    expect(s.kind).toBe("waiting");
  });
});

describe("textos", () => {
  it("el ritmo, redondeado a media hora", () => {
    expect(intervalLabel(180)).toBe("cada 3 h");
    expect(intervalLabel(131)).toBe("cada 2 h");
    expect(intervalLabel(150)).toBe("cada 2,5 h");
    expect(intervalLabel(62)).toBe("cada 60 min");
    expect(intervalLabel(null)).toBeNull();
  });

  it("una estadía", () => {
    expect(stayLabel(["2026-11-22", "2026-11-24"])).toBe("22/11 → 24/11");
  });
});
