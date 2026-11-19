import { describe, expect, it } from "vitest";
import {
  REFILL_GRACE_MS,
  archivedIcalUid,
  dedupeKeyOverCancelled,
  isNewStayInSameSlot,
  isRefilledAfterLocalCancel,
  refilledSlots,
  slotKey,
} from "../same-slot";

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

describe("dedupeKeyOverCancelled", () => {
  const key = "ical:link:uid@booking.com:abcd1234";

  it("sobre una fila cancelada el evento se deduplica aparte: puede ser otra persona con las mismas fechas", () => {
    const k = dedupeKeyOverCancelled(key, { id: "res-1", external_status: "cancelled" });
    expect(k).not.toBe(key);
    expect(k.startsWith(key)).toBe(true);
    // Una vez por fila: la misma fila cancelada da siempre la misma clave.
    expect(dedupeKeyOverCancelled(key, { id: "res-1", external_status: "cancelled" })).toBe(k);
  });

  it("en cualquier otro estado, la clave de siempre", () => {
    expect(dedupeKeyOverCancelled(key, { id: "res-1", external_status: "active" })).toBe(key);
    expect(dedupeKeyOverCancelled(key, null)).toBe(key);
  });

  it("sobre una fila activa cuya reserva local canceló una persona, también aparte", () => {
    const k = dedupeKeyOverCancelled(key, { id: "res-1", external_status: "active" }, true);
    expect(k).toBe(dedupeKeyOverCancelled(key, { id: "res-1", external_status: "cancelled" }));
    expect(dedupeKeyOverCancelled(key, null, true)).toBe(key);
  });
});

describe("isRefilledAfterLocalCancel", () => {
  // Pampa Mora (Habitana): Rodolfo 4→6/12 por Booking, Cecilia la canceló a
  // mano el 18/11 a las 15:35 y Booking sigue publicando las mismas noches.
  const today = "2026-11-18";
  const now = Date.parse("2026-11-18T19:30:00Z");
  const row = {
    channel: "booking" as const,
    external_status: "active" as const,
    booking_id: "b-rodolfo",
    is_block: false,
    check_in: "2026-12-04",
    check_out: "2026-12-06",
  };
  const local = { status: "cancelada", cancelled_at: "2026-11-18T18:35:00Z" };
  const ev = { checkIn: "2026-12-04", checkOut: "2026-12-06" };

  it("mismas fechas, reserva local cancelada hace más de media hora: es otra persona en el hueco", () => {
    expect(isRefilledAfterLocalCancel(row, local, ev, today, now)).toBe(true);
  });

  it("recién cancelada no: si la OTA también la canceló, su feed todavía no la sacó", () => {
    const recent = { ...local, cancelled_at: new Date(now - REFILL_GRACE_MS + 60_000).toISOString() };
    expect(isRefilledAfterLocalCancel(row, recent, ev, today, now)).toBe(false);
  });

  it("con la reserva local viva, o sin saber cuándo se canceló, no", () => {
    expect(isRefilledAfterLocalCancel(row, { status: "confirmada", cancelled_at: null }, ev, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel(row, { status: "cancelada", cancelled_at: null }, ev, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel(row, null, ev, today, now)).toBe(false);
  });

  it("llegada hoy o pasada no: es un no-show o una salida anticipada", () => {
    const hoy = { ...row, check_in: today, check_out: "2026-11-20" };
    expect(isRefilledAfterLocalCancel(hoy, local, { checkIn: today, checkOut: "2026-11-20" }, today, now)).toBe(false);
  });

  it("con otras fechas no: eso lo resuelve el paso 5b de la ingesta", () => {
    expect(isRefilledAfterLocalCancel(row, local, { checkIn: "2026-12-04", checkOut: "2026-12-07" }, today, now)).toBe(false);
  });

  it("sólo Booking reusa el UID; un cierre o una fila no activa no", () => {
    expect(isRefilledAfterLocalCancel({ ...row, channel: "airbnb" as const }, local, ev, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel({ ...row, is_block: true }, local, ev, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel(row, local, { ...ev, isBlock: true }, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel({ ...row, external_status: "cancelled" as const }, local, ev, today, now)).toBe(false);
    expect(isRefilledAfterLocalCancel({ ...row, booking_id: null }, local, ev, today, now)).toBe(false);
  });
});

describe("refilledSlots", () => {
  const uid = "7069d1937654cc12f8785b20345ff559@booking.com";

  it("un hueco que ya entró solo una vez queda anotado con sus fechas", () => {
    const archived = { ical_uid: archivedIcalUid(uid, "res-rodolfo"), check_in: "2026-12-04", check_out: "2026-12-06" };
    const live = { ical_uid: uid, check_in: "2026-12-04", check_out: "2026-12-06" };
    const slots = refilledSlots([archived, live]);
    expect(slots.has(slotKey(uid, "2026-12-04", "2026-12-06"))).toBe(true);
    // Otras fechas en el mismo UID son otra estadía.
    expect(slots.has(slotKey(uid, "2026-12-04", "2026-12-07"))).toBe(false);
    expect(slots.size).toBe(1);
  });

  it("sin filas archivadas, nada", () => {
    expect(refilledSlots([{ ical_uid: uid, check_in: "2026-12-04", check_out: "2026-12-06" }]).size).toBe(0);
    expect(refilledSlots([{ ical_uid: null, check_in: null, check_out: null }]).size).toBe(0);
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
