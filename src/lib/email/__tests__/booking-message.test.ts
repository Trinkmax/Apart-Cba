import { describe, expect, it } from "vitest";
import {
  bookingMessageVariables,
  missingUnitFields,
  renderGuestMessage,
  templateUsesDeposit,
  withDeposit,
  type BookingMessageSource,
} from "../booking-message";
import { DEFAULT_GUEST_MESSAGES } from "../templates/guest-defaults";
import { findInvalidVariables } from "../templates/variables";

// Intl es-AR separa "$" del número con un espacio duro.
const plain = (s: string) => s.replace(/ /g, " ");

const base: BookingMessageSource = {
  booking: {
    check_in_date: "2026-10-23",
    check_out_date: "2026-10-26",
    check_in_time: "14:00:00",
    check_out_time: "10:00:00",
    guests_count: 2,
    total_amount: "300000",
    paid_amount: 0,
    deposit_amount: null,
    security_deposit: null,
    currency: "ARS",
  },
  guest: { full_name: "  Lucía Fernández Paz ", phone: "+54 9 351 000-0000" },
  unit: {
    name: "Alto Tucumán ",
    code: "AT4B",
    address: "Tucumán 2250",
    marketplace_title: null,
    guest_maps_url: "https://maps.app.goo.gl/abc",
    guest_instructions: "Piso 4, depto B.\nWifi: AT4B / clave 1234",
  },
  org: { name: "Habitana" },
};

describe("bookingMessageVariables", () => {
  it("fechas largas, horas sin segundos y nombre sin espacios sobrantes", () => {
    const v = bookingMessageVariables(base);
    expect(v.booking.check_in_date).toBe("viernes 23 de octubre");
    expect(v.booking.check_out_date).toBe("lunes 26 de octubre");
    expect(v.booking.check_in_time).toBe("14:00");
    expect(v.booking.check_out_time).toBe("10:00");
    expect(v.booking.nights).toBe(3);
    expect(v.booking.guests).toBe("2 personas");
    expect(v.guest.full_name).toBe("Lucía Fernández Paz");
    expect(v.guest.first_name).toBe("Lucía");
    expect(v.unit.name).toBe("Alto Tucumán");
    expect(plain(v.booking.total_amount)).toBe("$ 300.000");
  });

  it("la seña sigue la misma regla que el mensaje original: informada → cobrada → 1 noche", () => {
    expect(plain(bookingMessageVariables(base).booking.deposit_amount)).toBe("$ 100.000");
    const cobrada = bookingMessageVariables({ ...base, booking: { ...base.booking, paid_amount: 50000 } });
    expect(plain(cobrada.booking.deposit_amount)).toBe("$ 50.000");
    expect(plain(cobrada.booking.remaining_after_deposit)).toBe("$ 250.000");
    expect(plain(cobrada.booking.balance_due)).toBe("$ 250.000");
    const sinSena = bookingMessageVariables({ ...base, booking: { ...base.booking, deposit_amount: 0 } });
    expect(sinSena.booking.deposit_amount).toBe("a coordinar");
    expect(sinSena.booking.remaining_after_deposit).toBe("a coordinar");
  });

  it("una persona en singular y sin depósito en garantía no dice nada", () => {
    const v = bookingMessageVariables({ ...base, booking: { ...base.booking, guests_count: 1 } });
    expect(v.booking.guests).toBe("1 persona");
    expect(v.booking.security_deposit).toBe("");
  });

  it("el título de la web le gana al nombre interno", () => {
    const v = bookingMessageVariables({ ...base, unit: { ...base.unit, marketplace_title: "Depto con balcón" } });
    expect(v.unit.name).toBe("Depto con balcón");
  });
});

describe("withDeposit", () => {
  it("recalcula seña y restante en vivo", () => {
    const v = withDeposit(bookingMessageVariables(base), 120000, 300000);
    expect(plain(v.booking.deposit_amount)).toBe("$ 120.000");
    expect(plain(v.booking.remaining_after_deposit)).toBe("$ 180.000");
    expect(withDeposit(v, null, 300000).booking.deposit_amount).toBe("a coordinar");
  });
});

describe("renderGuestMessage", () => {
  it("completa las variables y no deja huecos dobles si falta el instructivo", () => {
    const v = bookingMessageVariables({ ...base, unit: { ...base.unit, guest_instructions: null } });
    const out = renderGuestMessage("Hola {{guest.first_name}}!\n\n{{unit.instructions}}\n\nChau  ", v);
    expect(out).toBe("Hola Lucía!\n\nChau");
  });

  it("el instructivo de arranque sale completo con los datos del depto", () => {
    const out = renderGuestMessage(DEFAULT_GUEST_MESSAGES.booking_instructions, bookingMessageVariables(base));
    expect(out).toContain("¡Hola Lucía! 👋 Te paso todo lo que necesitás para tu llegada a Alto Tucumán.");
    expect(out).toContain("📅 Ingreso: viernes 23 de octubre desde las 14:00");
    expect(out).toContain("🗺️ Cómo llegar: https://maps.app.goo.gl/abc");
    expect(out).toContain("Piso 4, depto B.\nWifi: AT4B / clave 1234");
    expect(out).not.toContain("{{");
  });
});

describe("plantillas de arranque", () => {
  it("sólo usan variables permitidas", () => {
    expect(findInvalidVariables(DEFAULT_GUEST_MESSAGES.booking_confirmed, "booking_confirmed")).toEqual([]);
    expect(findInvalidVariables(DEFAULT_GUEST_MESSAGES.booking_instructions, "booking_instructions")).toEqual([]);
  });

  it("la confirmación usa la seña y el instructivo no", () => {
    expect(templateUsesDeposit(DEFAULT_GUEST_MESSAGES.booking_confirmed)).toBe(true);
    expect(templateUsesDeposit(DEFAULT_GUEST_MESSAGES.booking_instructions)).toBe(false);
    expect(templateUsesDeposit("Garantía: $ 500.000\nTotal: {{booking.total_amount}}")).toBe(false);
  });
});

describe("missingUnitFields", () => {
  it("avisa sólo lo que la plantilla usa y el depto no tiene", () => {
    const v = bookingMessageVariables({ ...base, unit: { ...base.unit, guest_maps_url: "", guest_instructions: null } });
    expect(missingUnitFields(DEFAULT_GUEST_MESSAGES.booking_instructions, v)).toEqual([
      "el link de Google Maps",
      "el instructivo",
    ]);
    expect(missingUnitFields("Hola {{guest.first_name}}", v)).toEqual([]);
  });
});
