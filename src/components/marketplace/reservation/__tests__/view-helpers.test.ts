import { describe, expect, it } from "vitest";
import { amountDueOnArrival, groupCbu, mapsUrl, responseDeadline, stageTitleParts, stayQuery } from "../view-helpers";

describe("responseDeadline", () => {
  const created = "2026-09-29T12:17:00.000Z";
  it("es la hora del pedido + las horas de respuesta, no el vencimiento de 48 h", () => {
    expect(responseDeadline(created, 24, "2026-10-01T12:17:00.000Z")).toBe("2026-09-30T12:17:00.000Z");
    expect(responseDeadline(created, 6)).toBe("2026-09-29T18:17:00.000Z");
  });
  it("sin horas válidas usa 24 h", () => {
    expect(responseDeadline(created, 0)).toBe("2026-09-30T12:17:00.000Z");
    expect(responseDeadline(created, Number.NaN)).toBe("2026-09-30T12:17:00.000Z");
  });
  it("si el pedido vence antes, manda el vencimiento", () => {
    expect(responseDeadline(created, 24, "2026-09-29T20:00:00.000Z")).toBe("2026-09-29T20:00:00.000Z");
  });
  it("sin fecha de pedido válida no promete nada", () => {
    expect(responseDeadline("", 24)).toBeNull();
  });
});

describe("stageTitleParts", () => {
  it("agrega el punto coral en noticias buenas", () => {
    expect(stageTitleParts("Recibimos tu pedido", "info")).toEqual({ text: "Recibimos tu pedido", dot: true });
    expect(stageTitleParts("Todo listo. Dale, pasá.", "ok")).toEqual({ text: "Todo listo. Dale, pasá", dot: true });
  });
  it("no lo agrega con signos ni en malas noticias", () => {
    expect(stageTitleParts("¡Qué lindo tenerte por Córdoba!", "ok").dot).toBe(false);
    expect(stageTitleParts("No pudimos confirmar tu pedido", "error").dot).toBe(false);
  });
});

describe("stayQuery", () => {
  const view = { stay: { check_in: "2026-10-03", check_out: "2026-10-06", nights: 3, guests: 2 } };
  it("lleva fechas si la llegada no pasó", () => {
    expect(stayQuery(view, "2026-10-01")).toBe("?checkin=2026-10-03&checkout=2026-10-06&huespedes=2");
    expect(stayQuery(view, "2026-10-03")).toBe("?checkin=2026-10-03&checkout=2026-10-06&huespedes=2");
  });
  it("sin fechas pasadas", () => {
    expect(stayQuery(view, "2026-10-04")).toBe("?huespedes=2");
  });
});

describe("amountDueOnArrival", () => {
  const base = { currency: "ARS", total: 300000, sena: 100000, sena_is_estimate: false, resto: 200000, sena_due_at: null, sena_covered: false };
  it("el resto después de la seña", () => {
    expect(amountDueOnArrival({ ...base, paid: 0 })).toBe(200000);
    expect(amountDueOnArrival({ ...base, paid: 100000 })).toBe(200000);
  });
  it("si pagó de más, descuenta lo cobrado", () => {
    expect(amountDueOnArrival({ ...base, paid: 250000 })).toBe(50000);
    expect(amountDueOnArrival({ ...base, paid: 400000 })).toBe(0);
  });
});

describe("mapsUrl y groupCbu", () => {
  it("mapsUrl agrega Córdoba si falta", () => {
    expect(mapsUrl("Paraná 123")).toBe("https://www.google.com/maps/search/?api=1&query=Paran%C3%A1%20123%2C%20C%C3%B3rdoba");
    expect(mapsUrl("Paraná 123, Córdoba")).toContain("Paran%C3%A1%20123%2C%20C%C3%B3rdoba");
  });
  it("groupCbu agrupa de a 4 sólo si tiene 22 dígitos", () => {
    expect(groupCbu("0170099640000012345678")).toBe("0170 0996 4000 0012 3456 78");
    expect(groupCbu("123")).toBe("123");
  });
});
