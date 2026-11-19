import { describe, it, expect } from "vitest";
import {
  boardEmptyState,
  filterBoardUnits,
  type BoardEmptyStateInput,
  type BoardUnitCounts,
} from "../pms-unit-filter";

// Viaggiato el 19/11/2026, "Buscar disp" del 19 al 23/11 (datos de producción).
const CODES = [
  "ABASTO", "ACBA", "BALVA", "CALA", "CALAII", "CARLUCCI", "CATA", "CATAII", "CENTRO", "FRIAS",
  "GAMA", "GUEMES", "JAC", "JAII", "JARDINES", "LARRA", "LAVA", "SALGUERO", "VELEZ", "VIA", "VILLASOL",
];
type Unit = { id: string; code: string; max_guests: number };
const UNITS: Unit[] = CODES.map((code) => ({ id: code, code, max_guests: code === "CALA" ? 2 : 4 }));
/** Con reserva que se pisa con [19/11, 23/11). */
const BUSY = new Set([
  "ABASTO", "BALVA", "CALAII", "CARLUCCI", "CATAII", "CENTRO", "GAMA", "JAII", "JARDINES",
  "LARRA", "LAVA", "SALGUERO", "VELEZ", "VIA", "VILLASOL",
]);
/** Las cinco de «Sucios 5»: salen hoy o mañana, o tienen la limpieza abierta. */
const DIRTY = new Set(["CARLUCCI", "CENTRO", "JARDINES", "LAVA", "VILLASOL"]);
const FREE = ["ACBA", "CALA", "CATA", "FRIAS", "GUEMES", "JAC"];

const RANGE = "19 nov al 23 nov 2026";

function run(opts: {
  onlyDirty?: boolean;
  busy?: ReadonlySet<string> | null;
  searchShown?: ReadonlySet<string> | null;
  minGuests?: number;
}) {
  return filterBoardUnits({
    units: UNITS,
    searchShown: opts.searchShown ?? null,
    passesAttributes: (u) => opts.minGuests === undefined || u.max_guests >= opts.minGuests,
    busy: opts.busy === undefined ? BUSY : opts.busy,
    onlyDirty: opts.onlyDirty ?? false,
    isDirty: (id) => DIRTY.has(id),
  });
}

function emptyState(counts: BoardUnitCounts, over: Partial<BoardEmptyStateInput> = {}) {
  return boardEmptyState({
    query: "",
    searchActive: false,
    counts,
    availabilityReady: true,
    rangeLabel: RANGE,
    onlyDirty: false,
    attributeFiltersActive: false,
    isMobile: false,
    ...over,
  });
}

describe("filterBoardUnits", () => {
  it("con un rango muestra las libres, en el orden de la grilla", () => {
    const { units, counts } = run({});
    expect(units.map((u) => u.code)).toEqual(FREE);
    expect(counts).toEqual({
      searchMatches: 21,
      attrMisses: 0,
      busyMatches: 15,
      dirtyMatches: 0,
      hiddenByDirty: 0,
    });
  });

  it("«Sucios» + rango (el reclamo): sin filas, pero cuenta las libres que esconde", () => {
    const { units, counts } = run({ onlyDirty: true });
    expect(units).toEqual([]);
    // Los motivos se cuentan sobre las 21, no sólo sobre las 5 sucias.
    expect(counts).toEqual({
      searchMatches: 21,
      attrMisses: 0,
      busyMatches: 15,
      dirtyMatches: 5,
      hiddenByDirty: 6,
    });
  });

  it("«Sucios» sin rango muestra las sucias", () => {
    const { units, counts } = run({ onlyDirty: true, busy: null });
    expect(units.map((u) => u.code)).toEqual(["CARLUCCI", "CENTRO", "JARDINES", "LAVA", "VILLASOL"]);
    expect(counts.hiddenByDirty).toBe(16);
  });

  it("una sucia libre en el rango se muestra", () => {
    const busy = new Set([...BUSY].filter((id) => id !== "CENTRO"));
    const { units } = run({ onlyDirty: true, busy });
    expect(units.map((u) => u.code)).toEqual(["CENTRO"]);
  });

  it("lo que no cumple los filtros cuenta como tal aunque esté ocupada o limpia", () => {
    const { units, counts } = run({ minGuests: 3, onlyDirty: true });
    expect(units).toEqual([]);
    // CALA (2 huéspedes) no cumple: no se cuenta ni como ocupada ni como escondida.
    expect(counts.attrMisses).toBe(1);
    expect(counts.busyMatches).toBe(15);
    expect(counts.hiddenByDirty).toBe(5);
  });

  it("la búsqueda libre elige qué unidades se miran", () => {
    const { units, counts } = run({ searchShown: new Set(["CALA", "CALAII"]) });
    expect(units.map((u) => u.code)).toEqual(["CALA"]);
    expect(counts.searchMatches).toBe(2);
    expect(counts.busyMatches).toBe(1);
  });
});

describe("boardEmptyState", () => {
  it("«Sucios» + rango: dice que se miran sólo las sucias y cuántas libres hay sin ese filtro", () => {
    const s = emptyState(run({ onlyDirty: true }).counts, { onlyDirty: true });
    expect(s.title).toBe("Estás viendo sólo las sucias");
    expect(s.body).toBe(
      `Con «Sucios» prendido se miran sólo las 5 unidades para limpiar, y ninguna está libre del ${RANGE}. Sin ese filtro hay 6 libres.`,
    );
    expect(s.dirtyAction).toBe("Ver las 6 libres");
    // Lo que decía antes: verdad a medias, sobre 5 de 21.
    expect(s.body).not.toContain("Las 5 unidades están ocupadas");
  });

  it("con otros filtros puestos lo aclara", () => {
    const s = emptyState(run({ onlyDirty: true, minGuests: 3 }).counts, {
      onlyDirty: true,
      attributeFiltersActive: true,
    });
    expect(s.body).toBe(
      `Con «Sucios» prendido se miran sólo las 5 unidades para limpiar, y ninguna está libre del ${RANGE} con esos filtros. Sin ese filtro hay 5 libres.`,
    );
  });

  it("singular: una sola sucia y una sola libre escondida", () => {
    const counts: BoardUnitCounts = {
      searchMatches: 3,
      attrMisses: 0,
      busyMatches: 2,
      dirtyMatches: 1,
      hiddenByDirty: 1,
    };
    const s = emptyState(counts, { onlyDirty: true });
    expect(s.body).toBe(
      `Con «Sucios» prendido se mira sólo la unidad para limpiar, y no está libre del ${RANGE}. Sin ese filtro hay 1 libre.`,
    );
    expect(s.dirtyAction).toBe("Ver la que está libre");
  });

  it("«Sucios» + búsqueda de una unidad limpia, sin rango", () => {
    const counts = run({ onlyDirty: true, busy: null, searchShown: new Set(["CALA", "CALAII"]) }).counts;
    const s = emptyState(counts, {
      onlyDirty: true,
      searchActive: true,
      query: "CALA",
      availabilityReady: false,
      rangeLabel: null,
    });
    expect(s.title).toBe("Estás viendo sólo las sucias");
    expect(s.body).toBe(
      "Con «Sucios» prendido se miran sólo las unidades para limpiar, y ninguna coincide con “CALA”. Sin ese filtro se ven 2.",
    );
    expect(s.dirtyAction).toBe("Ver todas");
  });

  it("si sin «Sucios» tampoco hay libres, cuenta todas las unidades", () => {
    const counts = run({ onlyDirty: true, busy: new Set(CODES) }).counts;
    expect(counts.hiddenByDirty).toBe(0);
    const s = emptyState(counts, { onlyDirty: true });
    expect(s.title).toBe("No hay unidades libres en esas fechas");
    expect(s.body).toBe(`Las 21 unidades están ocupadas del ${RANGE}.`);
    expect(s.busy).toBe(true);
    expect(s.dirtyAction).toBeNull();
  });

  it("sin «Sucios»: la unidad buscada está ocupada", () => {
    const counts = run({ searchShown: new Set(["CALAII"]) }).counts;
    const s = emptyState(counts, { searchActive: true, query: "CALAII" });
    expect(s.title).toBe("La unidad que buscás está ocupada en esas fechas");
    expect(s.body).toBe(`“CALAII” coincide con 1 unidad, pero está ocupada del ${RANGE}.`);
    expect(s.busy).toBe(true);
  });

  it("sin «Sucios»: nada coincide con la búsqueda", () => {
    const counts = run({ searchShown: new Set() }).counts;
    const s = emptyState(counts, { searchActive: true, query: "XYZ" });
    expect(s.title).toBe("Ninguna unidad coincide con la búsqueda");
    expect(s.body).toContain("La búsqueda global del buscador mira todas las fechas.");
    expect(emptyState(counts, { searchActive: true, query: "XYZ", isMobile: true }).body).not.toContain(
      "búsqueda global",
    );
  });

  it("sin «Sucios»: ocupadas y que no cumplen, con los dos números", () => {
    const counts = run({ minGuests: 3, busy: new Set([...BUSY, ...FREE.filter((c) => c !== "CALA")]) }).counts;
    const s = emptyState(counts, { attributeFiltersActive: true });
    expect(s.body).toBe(
      `20 unidades están ocupadas del ${RANGE} y 1 no cumple los otros filtros de búsqueda (huéspedes, precio, dormitorios, baños, barrio, modo).`,
    );
  });
});
