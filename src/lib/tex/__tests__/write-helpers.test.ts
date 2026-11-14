import { describe, expect, it, vi } from "vitest";

// `_shared.ts` envuelve server actions: acá sólo se prueba lo puro, así que se
// cortan en el import (no se llaman).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/bookings", () => ({ getBooking: vi.fn(), searchBookingsGlobal: vi.fn() }));
vi.mock("@/lib/actions/cash", () => ({ listAccounts: vi.fn() }));
vi.mock("@/lib/actions/guests", () => ({ getGuest: vi.fn(), searchGuests: vi.fn() }));
vi.mock("@/lib/actions/units", () => ({ listUnitRefs: vi.fn() }));

import type { Booking } from "@/lib/types/database";
import { choiceButtons } from "../replies";
import { bookingFingerprint, bookingInputFrom, guestDetail, matchPerson, type TeamPerson } from "../tools/write/_shared";

const BOOKING: Booking = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  unit_id: "33333333-3333-4333-8333-333333333333",
  guest_id: "44444444-4444-4444-8444-444444444444",
  source: "directo",
  external_id: null,
  external_url: null,
  status: "confirmada",
  is_block: false,
  mode: "temporario",
  check_in_date: "2026-11-20",
  check_in_time: "15:00",
  check_out_date: "2026-11-23",
  check_out_time: "10:00",
  guests_count: 2,
  currency: "ARS",
  total_amount: 180_000,
  paid_amount: 50_000,
  commission_pct: 20,
  commission_amount: 36_000,
  channel_commission_pct: null,
  channel_commission_amount: null,
  cleaning_fee: 15_000,
  monthly_rent: null,
  monthly_expenses: null,
  security_deposit: null,
  deposit_amount: null,
  monthly_inflation_adjustment_pct: null,
  rent_billing_day: null,
  lease_group_id: null,
  notes: "Llega tarde",
  internal_notes: null,
  checked_in_at: null,
  checked_out_at: null,
  cancelled_at: null,
  cancelled_reason: null,
  cancelled_by: null,
  cancelled_source: null,
  confirmation_sent_at: null,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  created_by: null,
};

describe("lo que se le manda a updateBooking (que reemplaza la fila)", () => {
  it("arma el input completo con lo que la reserva tiene hoy", () => {
    const i = bookingInputFrom(BOOKING);
    expect(i).toMatchObject({
      status: "confirmada",
      check_in_time: "15:00",
      currency: "ARS",
      total_amount: 180_000,
      paid_amount: 50_000,
      commission_pct: 20,
      channel_commission_pct: null,
      cleaning_fee: 15_000,
      notes: "Llega tarde",
    });
  });

  it("lo que falta en la fila vuelve al default de la pantalla, no a vacío", () => {
    const i = bookingInputFrom({ ...BOOKING, check_in_time: null as unknown as string, guests_count: 0, currency: "" });
    expect(i.check_in_time).toBe("14:00");
    expect(i.guests_count).toBe(1);
    expect(i.currency).toBe("ARS");
  });
});

describe("huella de la reserva (no pisar lo que cambió entre proponer y confirmar)", () => {
  it("es estable", () => {
    expect(bookingFingerprint(BOOKING)).toBe(bookingFingerprint({ ...BOOKING }));
  });

  it("cambia si cambia CUALQUIER campo que reescribe updateBooking", () => {
    const base = bookingFingerprint(BOOKING);
    const input = bookingInputFrom(BOOKING) as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      const current = (BOOKING as unknown as Record<string, unknown>)[key];
      const changed =
        typeof current === "number"
          ? current + 1
          : key === "status"
            ? "check_in"
            : key === "mode"
              ? "mensual"
              : key === "source"
                ? "airbnb"
                : key.endsWith("_time")
                  ? "09:00"
                  : current === null
                    ? key.endsWith("_id") || key === "notes" || key === "internal_notes"
                      ? "algo"
                      : 7
                    : `${String(current)}x`;
      const other = { ...BOOKING, [key]: changed } as Booking;
      expect(bookingFingerprint(other), key).not.toBe(base);
    }
  });

  it("un cobro que entró en el medio la cambia", () => {
    expect(bookingFingerprint({ ...BOOKING, paid_amount: 80_000 })).not.toBe(bookingFingerprint(BOOKING));
  });
});

describe("personas del equipo", () => {
  const TEAM: TeamPerson[] = [
    { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", full_name: "María López", role: "limpieza" },
    { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", full_name: "María López", role: "recepcion" },
    { user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", full_name: "Jorge Díaz", role: "mantenimiento" },
  ];

  it("un nombre único se elige solo", () => {
    const r = matchPerson(TEAM, "jorge díaz");
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.value.full_name).toBe("Jorge Díaz");
  });

  it("dos con el mismo nombre se preguntan, con botones que se distinguen por el rol", () => {
    const r = matchPerson(TEAM, "María López");
    expect(r.ok).toBe("choose");
    if (r.ok === "choose") {
      expect(r.options).toHaveLength(2);
      const buttons = choiceButtons(r.options);
      expect(buttons).toHaveLength(2);
      expect(new Set(buttons).size).toBe(2);
    }
  });

  it("un nombre a medias nunca se elige solo", () => {
    expect(matchPerson(TEAM, "Jorg").ok).toBe("choose");
  });

  it("nadie con ese nombre: error con la lista del equipo", () => {
    const r = matchPerson(TEAM, "Pedro");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toContain("Jorge Díaz");
  });
});

describe("detalle de un huésped en una lista", () => {
  const g = {
    phone: null,
    email: null,
    document_number: null,
    last_stay_at: null,
    blacklisted: false,
    created_at: "2025-05-03T10:00:00Z",
  };
  it("con contacto, el contacto", () => {
    expect(guestDetail({ ...g, phone: "351 555-1234", document_number: "30123456" })).toBe("351 555-1234 · doc. 30123456");
  });
  it("sin nada, cuándo se cargó (dos «Juan Pérez» nunca quedan iguales)", () => {
    expect(guestDetail(g)).toBe("sin contacto · cargado el 03/05/2025");
  });
  it("marca la lista negra", () => {
    expect(guestDetail({ ...g, email: "a@b.com", blacklisted: true })).toBe("a@b.com · en lista negra");
  });
});
