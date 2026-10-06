import { describe, it, expect } from "vitest";
import {
  bookingMatchesQuery,
  bookingOwnFieldsMatch,
  bookingSearchEmphasis,
  normalizeSearchText,
  offscreenSearchMatches,
  searchPms,
  unitMatchesQuery,
  type PmsSearchBooking,
  type PmsSearchUnit,
} from "../pms-search";

const QUIROS1: PmsSearchUnit = {
  id: "u-q1",
  code: "QUIROS1",
  name: "Quirós 1",
  neighborhood: "Centro",
  address: "Duarte Quirós 1234",
};
const QUIROS2: PmsSearchUnit = {
  id: "u-q2",
  code: "QUIROS2",
  name: "Quirós 2",
  neighborhood: "Centro",
  address: "Duarte Quirós 1234",
};
const BRASIL: PmsSearchUnit = {
  id: "u-br",
  code: "BRASIL",
  name: "Brasil 45",
  neighborhood: "Nueva Córdoba",
  address: "Brasil 45",
};
const UNITS = [QUIROS1, QUIROS2, BRASIL];

function booking(
  id: string,
  unit: PmsSearchUnit,
  guest: string | null,
  extra: Partial<PmsSearchBooking> = {},
): PmsSearchBooking {
  return {
    id,
    unit_id: unit.id,
    external_id: null,
    guest: guest ? { full_name: guest } : null,
    unit: { code: unit.code, name: unit.name },
    ...extra,
  };
}

const BOOKINGS: PmsSearchBooking[] = [
  booking("b1", QUIROS1, "Ana Pérez"),
  booking("b2", QUIROS1, "Juan Gómez"),
  booking("b3", QUIROS2, null, { external_id: "HMABC123" }),
  booking("b4", BRASIL, "María Duarte"),
  booking("b5", BRASIL, "Carlos Ruiz", { guest: { full_name: "Carlos Ruiz", phone: "+54 9 351 563-9985", email: "carlos@example.com" } }),
];

describe("normalizeSearchText", () => {
  it("baja a minúsculas, saca tildes y colapsa espacios", () => {
    expect(normalizeSearchText("  Duarte   QUIRÓS ")).toBe("duarte quiros");
    expect(normalizeSearchText("Peña")).toBe("pena");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("unitMatchesQuery", () => {
  it("coincide por código, nombre, barrio y dirección", () => {
    expect(unitMatchesQuery(QUIROS1, "quiros1")).toBe(true);
    expect(unitMatchesQuery(BRASIL, "brasil 45")).toBe(true);
    expect(unitMatchesQuery(BRASIL, "nueva cordoba")).toBe(true);
    expect(unitMatchesQuery(QUIROS1, "duarte")).toBe(true);
  });
  it("ignora tildes de los dos lados", () => {
    expect(unitMatchesQuery(QUIROS1, normalizeSearchText("Quirós"))).toBe(true);
    expect(unitMatchesQuery(BRASIL, normalizeSearchText("cordóba"))).toBe(true);
  });
  it("query vacía o unidad ausente no coinciden", () => {
    expect(unitMatchesQuery(QUIROS1, "")).toBe(false);
    expect(unitMatchesQuery(null, "quiros")).toBe(false);
  });
});

describe("bookingOwnFieldsMatch / bookingMatchesQuery", () => {
  it("coincide por huésped y por código de la OTA", () => {
    expect(bookingOwnFieldsMatch(BOOKINGS[0], "perez")).toBe(true);
    expect(bookingOwnFieldsMatch(BOOKINGS[2], "hmabc")).toBe(true);
    expect(bookingOwnFieldsMatch(BOOKINGS[0], "duarte")).toBe(false);
  });
  it("coincide por mail y por teléfono escrito de otra forma", () => {
    expect(bookingOwnFieldsMatch(BOOKINGS[4], "carlos@exa")).toBe(true);
    expect(bookingOwnFieldsMatch(BOOKINGS[4], "3515639985", "3515639985")).toBe(true);
    expect(bookingOwnFieldsMatch(BOOKINGS[4], "563-9985", "563-9985")).toBe(true);
    // Muy pocos dígitos: no se compara como teléfono.
    expect(bookingOwnFieldsMatch(BOOKINGS[4], "99", "99")).toBe(false);
  });
  it("una reserva coincide también por los datos de su unidad (dirección/barrio)", () => {
    // Era el bug: buscar la dirección dejaba la unidad y escondía sus reservas.
    expect(bookingMatchesQuery(BOOKINGS[0], QUIROS1, "duarte")).toBe(true);
    expect(bookingMatchesQuery(BOOKINGS[0], QUIROS1, "centro")).toBe(true);
    expect(bookingMatchesQuery(BOOKINGS[0], QUIROS1, "brasil")).toBe(false);
  });
  it("sin la unidad en la lista usa el join liviano de la reserva", () => {
    expect(bookingMatchesQuery(BOOKINGS[0], null, "quiros1")).toBe(true);
  });
});

describe("searchPms", () => {
  it("sin búsqueda no filtra ni resalta nada", () => {
    const r = searchPms("   ", UNITS, BOOKINGS);
    expect(r.active).toBe(false);
    expect(r.shownUnitIds.size).toBe(0);
    expect(bookingSearchEmphasis(r, BOOKINGS[0])).toBe("none");
  });

  it("buscar una dirección muestra esas unidades CON todas sus reservas", () => {
    const r = searchPms("DUARTE", UNITS, BOOKINGS);
    expect(r.active).toBe(true);
    // QUIROS1/2 por dirección; BRASIL por la huésped "María Duarte".
    expect([...r.shownUnitIds].sort()).toEqual(["u-br", "u-q1", "u-q2"]);
    expect([...r.matchedUnitIds].sort()).toEqual(["u-q1", "u-q2"]);
    // Las reservas de QUIROS coinciden por su unidad: se pintan normales.
    for (const id of ["b1", "b2", "b3"]) {
      expect(r.matchedBookingIds.has(id)).toBe(true);
      expect(bookingSearchEmphasis(r, BOOKINGS.find((b) => b.id === id)!)).toBe("none");
    }
    // En BRASIL la unidad no coincide: se resalta la de María y se atenúa la otra.
    expect(bookingSearchEmphasis(r, BOOKINGS[3])).toBe("match");
    expect(bookingSearchEmphasis(r, BOOKINGS[4])).toBe("dim");
    expect([...r.ownMatchBookingIds]).toEqual(["b4"]);
  });

  it("buscar un huésped muestra su unidad sin esconder el resto de su ocupación", () => {
    const r = searchPms("gómez", UNITS, BOOKINGS);
    expect([...r.shownUnitIds]).toEqual(["u-q1"]);
    expect(r.matchedUnitIds.size).toBe(0);
    expect(bookingSearchEmphasis(r, BOOKINGS[1])).toBe("match");
    // La otra reserva de QUIROS1 sigue ahí, atenuada: la unidad está ocupada.
    expect(bookingSearchEmphasis(r, BOOKINGS[0])).toBe("dim");
  });

  it("una unidad sin reservas aparece si coincide por sus datos", () => {
    const empty: PmsSearchUnit = { id: "u-x", code: "OCAMPO", name: "Ocampo", address: "Ocampo 10" };
    const r = searchPms("ocampo", [...UNITS, empty], BOOKINGS);
    expect([...r.shownUnitIds]).toEqual(["u-x"]);
  });

  it("nada coincide → ninguna unidad", () => {
    const r = searchPms("zzz", UNITS, BOOKINGS);
    expect(r.active).toBe(true);
    expect(r.shownUnitIds.size).toBe(0);
    expect(r.matchedBookingIds.size).toBe(0);
  });
});

describe("offscreenSearchMatches", () => {
  type Dated = PmsSearchBooking & { check_in_date: string; check_out_date: string };
  function dated(b: PmsSearchBooking, checkIn: string, checkOut: string): Dated {
    return { ...b, check_in_date: checkIn, check_out_date: checkOut };
  }
  // Ventana dibujada: [1 oct, 31 oct).
  const FROM = "2026-10-01";
  const TO = "2026-10-31";

  it("una fila que aparece sólo por una coincidencia fuera de pantalla dice dónde está", () => {
    const list = [
      dated(booking("p1", BRASIL, "Ana Pérez"), "2026-11-12", "2026-11-15"),
      dated(booking("x1", BRASIL, "Otro Huésped"), "2026-10-05", "2026-10-08"),
    ];
    const r = searchPms("perez", UNITS, list);
    const m = offscreenSearchMatches(r, list, FROM, TO);
    expect(m.get(BRASIL.id)).toEqual({ bookingId: "p1", checkIn: "2026-11-12", direction: "after" });
  });

  it("si alguna coincidencia de la fila está en la ventana, no hace falta aviso", () => {
    const list = [
      dated(booking("p1", BRASIL, "Ana Pérez"), "2026-11-12", "2026-11-15"),
      dated(booking("p2", BRASIL, "Ana Pérez"), "2026-10-20", "2026-10-22"),
    ];
    const r = searchPms("perez", UNITS, list);
    expect(offscreenSearchMatches(r, list, FROM, TO).size).toBe(0);
    // El orden de la lista no cambia el resultado.
    const reversed = list.slice().reverse();
    expect(offscreenSearchMatches(searchPms("perez", UNITS, reversed), reversed, FROM, TO).size).toBe(0);
  });

  it("una reserva que cruza el borde de la ventana cuenta como visible", () => {
    const list = [dated(booking("p1", BRASIL, "Ana Pérez"), "2026-09-28", "2026-10-02")];
    const r = searchPms("perez", UNITS, list);
    expect(offscreenSearchMatches(r, list, FROM, TO).size).toBe(0);
  });

  it("elige la coincidencia más cercana; a igual distancia, la que viene", () => {
    const list = [
      dated(booking("past", BRASIL, "Ana Pérez"), "2026-09-20", "2026-09-26"), // termina 5 días antes
      dated(booking("far", BRASIL, "Ana Pérez"), "2026-12-20", "2026-12-24"),
      dated(booking("next", BRASIL, "Ana Pérez"), "2026-11-05", "2026-11-08"), // empieza 5 días después
    ];
    const r = searchPms("perez", UNITS, list);
    expect(offscreenSearchMatches(r, list, FROM, TO).get(BRASIL.id)).toEqual({
      bookingId: "next",
      checkIn: "2026-11-05",
      direction: "after",
    });
    const onlyPast = [list[0], list[1]];
    expect(
      offscreenSearchMatches(searchPms("perez", UNITS, onlyPast), onlyPast, FROM, TO).get(BRASIL.id),
    ).toEqual({ bookingId: "past", checkIn: "2026-09-20", direction: "before" });
  });

  it("una unidad que coincide por sus propios datos no lleva aviso", () => {
    const list = [dated(booking("q1", QUIROS1, "Ana Pérez"), "2026-12-01", "2026-12-03")];
    // "quiros" hace coincidir a la unidad (código/dirección): se muestra por eso.
    expect(offscreenSearchMatches(searchPms("quiros", UNITS, list), list, FROM, TO).size).toBe(0);
  });

  it("sin búsqueda, o sin coincidencias propias, no hay avisos", () => {
    const list = [dated(booking("p1", BRASIL, "Ana Pérez"), "2026-11-12", "2026-11-15")];
    expect(offscreenSearchMatches(searchPms("", UNITS, list), list, FROM, TO).size).toBe(0);
    expect(offscreenSearchMatches(searchPms("zzz", UNITS, list), list, FROM, TO).size).toBe(0);
  });
});
