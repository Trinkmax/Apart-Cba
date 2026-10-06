import { describe, it, expect } from "vitest";
import {
  AVAILABILITY_MAX_DAYS,
  checkAvailabilityRange,
  computeUnitAvailability,
  rangesOverlap,
  statusOccupies,
  type OccupancyBooking,
  type OccupancyRequest,
} from "../availability";

function b(
  id: string,
  unit_id: string,
  check_in_date: string,
  check_out_date: string,
  status = "confirmada",
  is_block = false,
): OccupancyBooking {
  return { id, unit_id, check_in_date, check_out_date, status, is_block };
}

function r(
  id: string,
  unit_id: string | null,
  check_in: string | null,
  check_out: string | null,
  holds_availability: boolean,
): OccupancyRequest {
  return { id, unit_id, check_in, check_out, holds_availability };
}

describe("checkAvailabilityRange", () => {
  it("sin alguna de las fechas no hay búsqueda (no es un error)", () => {
    expect(checkAvailabilityRange("", "")).toEqual({ ok: false, reason: "incomplete", message: null });
    expect(checkAvailabilityRange("2026-11-10", "")).toMatchObject({ ok: false, reason: "incomplete" });
  });
  it("rango válido devuelve noches y una clave estable", () => {
    expect(checkAvailabilityRange("2026-11-10", "2026-11-15")).toEqual({
      ok: true,
      from: "2026-11-10",
      to: "2026-11-15",
      nights: 5,
      key: "2026-11-10|2026-11-15",
    });
  });
  it("salida igual o anterior a la entrada es un error legible", () => {
    const same = checkAvailabilityRange("2026-11-10", "2026-11-10");
    expect(same).toMatchObject({ ok: false, reason: "order" });
    expect(checkAvailabilityRange("2026-11-10", "2026-11-09")).toMatchObject({ ok: false, reason: "order" });
  });
  it("fechas imposibles o mal formadas", () => {
    expect(checkAvailabilityRange("2026-02-31", "2026-03-05")).toMatchObject({ ok: false, reason: "invalid" });
    expect(checkAvailabilityRange("10/11/2026", "2026-11-15")).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("un año a medio tipear (0002-…) no dispara una búsqueda de 2000 años", () => {
    expect(checkAvailabilityRange("0002-11-10", "2026-11-15")).toMatchObject({ ok: false, reason: "too_long" });
    const end = new Date(Date.UTC(2026, 0, 1) + AVAILABILITY_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(checkAvailabilityRange("2026-01-01", end)).toMatchObject({ ok: true, nights: AVAILABILITY_MAX_DAYS });
  });
});

describe("rangesOverlap / statusOccupies", () => {
  it("el día de salida queda libre (semiabierto)", () => {
    expect(rangesOverlap("2026-11-01", "2026-11-10", "2026-11-10", "2026-11-12")).toBe(false);
    expect(rangesOverlap("2026-11-12", "2026-11-15", "2026-11-10", "2026-11-12")).toBe(false);
    expect(rangesOverlap("2026-11-01", "2026-11-11", "2026-11-10", "2026-11-12")).toBe(true);
    // Reserva que contiene al rango entero.
    expect(rangesOverlap("2026-10-01", "2026-12-01", "2026-11-10", "2026-11-12")).toBe(true);
  });
  it("cancelada y no_show no ocupan; el resto sí", () => {
    expect(statusOccupies("cancelada")).toBe(false);
    expect(statusOccupies("no_show")).toBe(false);
    for (const s of ["pendiente", "confirmada", "check_in", "check_out"]) {
      expect(statusOccupies(s)).toBe(true);
    }
  });
});

describe("computeUnitAvailability", () => {
  const from = "2026-11-10";
  const to = "2026-11-15";

  it("reserva que se pisa con el rango ocupa la unidad", () => {
    const res = computeUnitAvailability({ from, to, bookings: [b("1", "A", "2026-11-12", "2026-11-20")] });
    expect([...res.busy]).toEqual(["A"]);
  });

  it("recambio el mismo día: sale el día de entrada o entra el día de salida → libre", () => {
    const res = computeUnitAvailability({
      from,
      to,
      bookings: [
        b("1", "A", "2026-11-05", "2026-11-10"), // sale el día que entro
        b("2", "A", "2026-11-15", "2026-11-18"), // entra el día que salgo
      ],
    });
    expect(res.busy.size).toBe(0);
  });

  it("canceladas y no_show no ocupan", () => {
    const res = computeUnitAvailability({
      from,
      to,
      bookings: [
        b("1", "A", "2026-11-11", "2026-11-13", "cancelada"),
        b("2", "B", "2026-11-11", "2026-11-13", "no_show"),
        b("3", "C", "2026-11-11", "2026-11-13", "pendiente"),
        b("4", "D", "2026-11-11", "2026-11-13", "check_out"),
      ],
    });
    expect([...res.busy].sort()).toEqual(["C", "D"]);
  });

  it("un cierre de calendario ocupa aunque no sea una reserva", () => {
    const res = computeUnitAvailability({
      from,
      to,
      bookings: [b("1", "A", "2026-11-01", "2026-12-01", "confirmada", true)],
    });
    expect(res.busy.has("A")).toBe(true);
  });

  it("solicitud que retiene → ocupada; que no retiene → aviso (sigue libre)", () => {
    const res = computeUnitAvailability({
      from,
      to,
      bookings: [],
      requests: [
        r("q1", "A", "2026-11-12", "2026-11-14", true),
        r("q2", "B", "2026-11-12", "2026-11-14", false),
        r("q3", "C", "2026-11-15", "2026-11-17", true), // empieza el día de salida
        r("q4", null, "2026-11-12", "2026-11-14", true), // sin unidad asignada
        r("q5", "D", null, null, true), // sin fechas
      ],
    });
    expect([...res.busy]).toEqual(["A"]);
    expect([...res.tentative]).toEqual(["B"]);
  });

  it("una unidad ocupada no queda además como 'aviso'", () => {
    const res = computeUnitAvailability({
      from,
      to,
      bookings: [b("1", "B", "2026-11-11", "2026-11-12")],
      requests: [r("q", "B", "2026-11-12", "2026-11-14", false)],
    });
    expect([...res.busy]).toEqual(["B"]);
    expect(res.tentative.size).toBe(0);
  });

  it("une la foto del server con el state local: alcanza con una versión que ocupe", () => {
    // El server todavía ve la reserva en A; localmente se movió a B (optimista).
    const server = [b("1", "A", "2026-11-11", "2026-11-13")];
    const local = [b("1", "B", "2026-11-11", "2026-11-13")];
    const res = computeUnitAvailability({ from, to, bookings: [...server, ...local] });
    expect([...res.busy].sort()).toEqual(["A", "B"]);
  });

  it("una reserva nueva que sólo existe en el state local ocupa", () => {
    const server: OccupancyBooking[] = [];
    const local = [b("tmp", "C", "2026-11-14", "2026-11-16")];
    const res = computeUnitAvailability({ from, to, bookings: [...server, ...local] });
    expect(res.busy.has("C")).toBe(true);
  });
});
