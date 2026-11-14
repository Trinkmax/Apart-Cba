import { describe, expect, it } from "vitest";
import { archivedIcalUid, isNewStayInSameSlot } from "../same-slot";

const cancelled = {
  is_block: false,
  confirmation_code: null,
  check_in: "2026-11-25",
  check_out: "2026-11-29",
  created_at: "2026-10-05T08:38:04Z",
};

const booking = { channel: "booking" as const, transport: "ical" as const, isBlock: false };

describe("isNewStayInSameSlot", () => {
  it("Booking vuelve a publicar el UID con otra salida: es otra persona (Pampa Mora 25→27)", () => {
    expect(isNewStayInSameSlot(cancelled, booking)).toBe(true);
  });

  it("con las mismas fechas también: Booking no trae nada que pruebe que es la misma", () => {
    expect(isNewStayInSameSlot({ ...cancelled, check_out: "2026-11-27" }, booking)).toBe(true);
  });

  it("un mail nunca dispara esto: trae su propio número", () => {
    expect(isNewStayInSameSlot(cancelled, { ...booking, transport: "email" })).toBe(false);
  });

  it("un cierre de fechas no es una estadía", () => {
    expect(isNewStayInSameSlot(cancelled, { ...booking, isBlock: true })).toBe(false);
    expect(isNewStayInSameSlot({ ...cancelled, is_block: true }, booking)).toBe(false);
  });

  it("mismo número de reserva: es la misma que volvió, lo decide una persona", () => {
    const airbnb = { channel: "airbnb" as const, transport: "ical" as const, confirmationCode: "HMABC123" };
    expect(isNewStayInSameSlot({ ...cancelled, confirmation_code: "HMABC123" }, airbnb)).toBe(false);
    expect(isNewStayInSameSlot({ ...cancelled, confirmation_code: "HMOTRO99" }, airbnb)).toBe(true);
  });

  it("una marca del borde de la ventana de Booking que vuelve a entrar al rango no es una reserva", () => {
    // COF II de Habitana: 1 noche en marzo de 2028, vista por primera vez en septiembre de 2026.
    const marca = { ...cancelled, check_in: "2028-03-02", check_out: "2028-03-03", created_at: "2026-09-01T10:00:00Z" };
    expect(isNewStayInSameSlot(marca, booking)).toBe(false);
    // La misma fecha, pero vista hace poco, sí es una reserva posible.
    expect(isNewStayInSameSlot({ ...marca, created_at: "2027-12-01T10:00:00Z" }, booking)).toBe(true);
  });

  it("un tramo de más de 120 noches es un cierre, no una estadía", () => {
    expect(isNewStayInSameSlot({ ...cancelled, check_in: "2027-04-01", check_out: "2028-05-03" }, booking)).toBe(false);
  });
});

describe("archivedIcalUid", () => {
  it("nunca coincide con el UID real y conserva de dónde vino", () => {
    const uid = "ea782c67a213e4a33a157a06a8fcc09e@booking.com";
    const archived = archivedIcalUid(uid, "aa9fcbc4-0ad5-4012-a6f9-d1eac24a290b");
    expect(archived).not.toBe(uid);
    expect(archived.startsWith(uid)).toBe(true);
  });
});
