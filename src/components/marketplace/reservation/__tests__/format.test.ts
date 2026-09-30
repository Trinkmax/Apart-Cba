import { describe, expect, it } from "vitest";
import {
  amountCopyValue,
  amountInputValue,
  atPhrase,
  beforePhrase,
  deadlineLabel,
  eventLabel,
  fileSizeLabel,
  guestsLabel,
  longDay,
  nightsLabel,
  remainingLabel,
  shortDay,
  stayRangeLong,
  stayRangeShort,
} from "../format";

describe("fechas de la estadía", () => {
  it("día corto y largo desde ISO, sin zona", () => {
    expect(shortDay("2026-10-03")).toBe("sáb 3 oct");
    expect(longDay("2026-10-02")).toBe("viernes 2 de octubre");
    expect(shortDay("basura")).toBe("basura");
  });

  it("rango corto con flecha", () => {
    expect(stayRangeShort("2026-10-02", "2026-10-04")).toBe("vie 2 oct → dom 4 oct");
  });

  it("rango largo: mismo mes, meses distintos y años distintos", () => {
    expect(stayRangeLong("2026-10-03", "2026-10-06")).toBe("3 al 6 de octubre");
    expect(stayRangeLong("2026-09-30", "2026-10-02")).toBe("30 de septiembre al 2 de octubre");
    expect(stayRangeLong("2026-12-28", "2027-01-02")).toBe("28 de diciembre de 2026 al 2 de enero de 2027");
  });

  it("plurales", () => {
    expect(nightsLabel(1)).toBe("1 noche");
    expect(nightsLabel(3)).toBe("3 noches");
    expect(guestsLabel(1)).toBe("1 huésped");
    expect(guestsLabel(4)).toBe("4 huéspedes");
  });
});

describe("vencimientos en hora de Córdoba (UTC-3)", () => {
  const now = new Date("2026-10-01T15:00:00Z"); // 12:00 en Córdoba

  it("hoy y mañana", () => {
    expect(deadlineLabel("2026-10-01T21:00:00Z", now)).toBe("hoy a las 18 h");
    expect(deadlineLabel("2026-10-02T17:30:00Z", now)).toBe("mañana a las 14:30 h");
  });

  it("más adelante, con día de la semana", () => {
    expect(deadlineLabel("2026-10-05T12:05:00Z", now)).toBe("lun 5 oct a las 9:05 h");
  });

  it("cruza la medianoche según Córdoba, no según UTC", () => {
    // 02:00 UTC del 2 = 23:00 del 1 en Córdoba → sigue siendo "hoy".
    expect(deadlineLabel("2026-10-02T02:00:00Z", now)).toBe("hoy a las 23 h");
  });

  it("frases con antes/el", () => {
    expect(beforePhrase("2026-10-01T21:00:00Z", now)).toBe("hoy antes de las 18 h");
    expect(beforePhrase("2026-10-05T12:00:00Z", now)).toBe("antes del lun 5 oct a las 9 h");
    expect(atPhrase("2026-10-02T17:30:00Z", now)).toBe("mañana a las 14:30 h");
    expect(atPhrase("2026-10-05T12:00:00Z", now)).toBe("el lun 5 oct a las 9 h");
  });

  it("evento pasado y fecha inválida", () => {
    expect(eventLabel("2026-10-01T17:45:00Z")).toBe("1 oct, 14:45 h");
    expect(deadlineLabel("no-es-fecha", now)).toBe("");
  });
});

describe("cuánto falta", () => {
  it("minutos, horas y días", () => {
    expect(remainingLabel(0)).toBeNull();
    expect(remainingLabel(30_000)).toBe("falta 1 minuto");
    expect(remainingLabel(40 * 60_000)).toBe("faltan 40 minutos");
    expect(remainingLabel(61 * 60_000)).toBe("falta 1 hora");
    expect(remainingLabel(5.5 * 3_600_000)).toBe("faltan 5 horas");
    expect(remainingLabel(50 * 3_600_000)).toBe("faltan 2 días");
  });
});

describe("montos y archivos", () => {
  it("prellenado y copiado de montos", () => {
    expect(amountInputValue(70000)).toBe("70.000");
    expect(amountInputValue(1250000.4)).toBe("1.250.000");
    expect(amountInputValue(null)).toBe("");
    expect(amountCopyValue(70000.2)).toBe("70000");
  });

  it("peso del comprobante", () => {
    expect(fileSizeLabel(350 * 1024)).toBe("350 KB");
    expect(fileSizeLabel(1.25 * 1024 * 1024)).toBe("1,3 MB");
    expect(fileSizeLabel(0)).toBe("0 KB");
  });
});
