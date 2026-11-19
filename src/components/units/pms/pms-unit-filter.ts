/**
 * Qué unidades muestra el calendario PMS con los filtros puestos, y por qué
 * quedó afuera cada una — lógica pura.
 *
 * Viaggiato (19/11/2026): «Buscar disp» del 19 al 23/11 decía «0 / 21
 * unidades libres · Las 5 unidades están ocupadas» con seis libres (CALA entre
 * ellas). Estaba prendido «Sucios», que deja sólo las unidades para limpiar, y
 * las cinco que había esa mañana tenían huésped. La búsqueda nunca miró las
 * otras 16, y el estado vacío contaba las que miró como si fueran todas.
 *
 * Por eso los motivos se cuentan sobre TODAS las unidades que coinciden con la
 * búsqueda y «Sucios» se aplica al final: `hiddenByDirty` dice cuántas se
 * verían sin ese filtro, y el estado vacío lo dice con una salida a un toque.
 */

export interface BoardUnitCounts {
  /** Coinciden con la búsqueda libre (todas, si no hay búsqueda). */
  searchMatches: number;
  /** De esas, no cumplen los filtros de "Buscar disp" (huéspedes, precio, dormitorios, baños, barrio, modo). */
  attrMisses: number;
  /** Cumplen los filtros pero están ocupadas en el rango de "Buscar disp". */
  busyMatches: number;
  /** Con «Sucios»: las que coinciden con la búsqueda y están para limpiar (las únicas que se miran). */
  dirtyMatches: number;
  /** Con «Sucios»: cumplen todo (y están libres, si hay rango) pero están limpias. Sin ese filtro se verían. */
  hiddenByDirty: number;
}

export const EMPTY_BOARD_UNIT_COUNTS: BoardUnitCounts = {
  searchMatches: 0,
  attrMisses: 0,
  busyMatches: 0,
  dirtyMatches: 0,
  hiddenByDirty: 0,
};

export interface BoardUnitFilterInput<U extends { id: string }> {
  units: readonly U[];
  /** Unidades que deja la búsqueda libre (`searchPms`); `null` sin búsqueda. */
  searchShown: ReadonlySet<string> | null;
  /** Huéspedes, precio, dormitorios, baños, barrio y modo de "Buscar disp". */
  passesAttributes: (unit: U) => boolean;
  /** Ocupadas en el rango de "Buscar disp" (`computeUnitAvailability`); `null` sin rango. */
  busy: ReadonlySet<string> | null;
  /** «Sucios» prendido: sólo las unidades para limpiar. */
  onlyDirty: boolean;
  isDirty: (unitId: string) => boolean;
}

/** Las filas del calendario (en el orden recibido) y los motivos de las que quedaron afuera. */
export function filterBoardUnits<U extends { id: string }>(
  input: BoardUnitFilterInput<U>,
): { units: U[]; counts: BoardUnitCounts } {
  const { searchShown, passesAttributes, busy, onlyDirty, isDirty } = input;
  const units: U[] = [];
  const counts: BoardUnitCounts = { ...EMPTY_BOARD_UNIT_COUNTS };
  for (const unit of input.units) {
    // La búsqueda elige qué unidades se muestran, nunca su ocupación (pms-search.ts).
    if (searchShown && !searchShown.has(unit.id)) continue;
    counts.searchMatches += 1;
    const dirty = onlyDirty && isDirty(unit.id);
    if (dirty) counts.dirtyMatches += 1;
    if (!passesAttributes(unit)) {
      counts.attrMisses += 1;
      continue;
    }
    // Veredicto del rango pedido, no de la ventana cargada.
    if (busy?.has(unit.id)) {
      counts.busyMatches += 1;
      continue;
    }
    if (onlyDirty && !dirty) {
      counts.hiddenByDirty += 1;
      continue;
    }
    units.push(unit);
  }
  return { units, counts };
}

export interface BoardEmptyStateInput {
  /** Lo que tipeó la persona en el buscador, sin espacios de más. */
  query: string;
  searchActive: boolean;
  counts: BoardUnitCounts;
  /** El rango de "Buscar disp" está verificado. */
  availabilityReady: boolean;
  /** "19 nov al 23 nov 2026", o null. */
  rangeLabel: string | null;
  onlyDirty: boolean;
  /** Hay filtros de "Buscar disp" además de las fechas (huéspedes, precio…). */
  attributeFiltersActive: boolean;
  /** En el celular no existe la búsqueda global del buscador. */
  isMobile: boolean;
}

export interface BoardEmptyState {
  title: string;
  body: string;
  /** Lo explica la ocupación del rango: se ofrece ir a esas fechas. */
  busy: boolean;
  /** Lo explica «Sucios»: el texto del botón que lo apaga. */
  dirtyAction: string | null;
}

const countUnits = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
const OTHER_FILTERS =
  "los otros filtros de búsqueda (huéspedes, precio, dormitorios, baños, barrio, modo)";

/**
 * Por qué el calendario quedó sin filas. "Nada coincide" sólo cuando de verdad
 * nada coincide; si la unidad buscada está ocupada en el rango, decirlo; y si
 * las filas las esconde «Sucios», decir eso y cuántas hay sin él.
 */
export function boardEmptyState(input: BoardEmptyStateInput): BoardEmptyState {
  const { query: q, searchActive, counts, availabilityReady: ready } = input;
  const { searchMatches, attrMisses, busyMatches, dirtyMatches, hiddenByDirty } = counts;
  const onDates = input.rangeLabel ? `del ${input.rangeLabel}` : "en esas fechas";

  if (searchActive && searchMatches === 0) {
    return {
      title: "Ninguna unidad coincide con la búsqueda",
      body:
        `Nada coincide con “${q}” en unidades (código, nombre, barrio, dirección) ni en las reservas cargadas.` +
        (input.isMobile ? "" : " La búsqueda global del buscador mira todas las fechas."),
      busy: false,
      dirtyAction: null,
    };
  }

  if (input.onlyDirty && hiddenByDirty > 0) {
    const where = searchActive ? ` que ${dirtyMatches === 1 ? "coincide" : "coinciden"} con “${q}”` : "";
    const withFilters = ready && input.attributeFiltersActive ? " con esos filtros" : "";
    const looked =
      dirtyMatches === 0
        ? `se miran sólo las unidades para limpiar, y ${searchActive ? `ninguna coincide con “${q}”` : "no hay ninguna"}`
        : dirtyMatches === 1
          ? `se mira sólo la unidad para limpiar${where}, y ${ready ? `no está libre ${onDates}${withFilters}` : "no cumple los filtros"}`
          : `se miran sólo las ${dirtyMatches} unidades para limpiar${where}, y ${ready ? `ninguna está libre ${onDates}${withFilters}` : "ninguna cumple los filtros"}`;
    const without = ready
      ? hiddenByDirty === 1
        ? "hay 1 libre"
        : `hay ${hiddenByDirty} libres`
      : hiddenByDirty === 1
        ? "se ve 1"
        : `se ven ${hiddenByDirty}`;
    return {
      title: "Estás viendo sólo las sucias",
      body: `Con «Sucios» prendido ${looked}. Sin ese filtro ${without}.`,
      busy: false,
      dirtyAction: ready
        ? hiddenByDirty === 1
          ? "Ver la que está libre"
          : `Ver las ${hiddenByDirty} libres`
        : "Ver todas",
    };
  }

  if (ready && busyMatches > 0) {
    const busyVerb = busyMatches === 1 ? "está ocupada" : "están ocupadas";
    const missVerb = attrMisses === 1 ? "no cumple" : "no cumplen";
    if (searchActive) {
      return {
        title:
          attrMisses > 0
            ? "Lo que buscás no está disponible en esas fechas"
            : searchMatches === 1
              ? "La unidad que buscás está ocupada en esas fechas"
              : "Las unidades que buscás están ocupadas en esas fechas",
        body:
          attrMisses > 0
            ? `“${q}” coincide con ${countUnits(searchMatches)}: ${busyMatches} ${busyVerb} ${onDates} y ${attrMisses} ${missVerb} ${OTHER_FILTERS}.`
            : `“${q}” coincide con ${countUnits(searchMatches)}, pero ${busyVerb} ${onDates}.`,
        busy: true,
        dirtyAction: null,
      };
    }
    return {
      title: "No hay unidades libres en esas fechas",
      body:
        attrMisses > 0
          ? `${countUnits(busyMatches)} ${busyVerb} ${onDates} y ${attrMisses} ${missVerb} ${OTHER_FILTERS}.`
          : `${busyMatches === 1 ? "La única unidad está ocupada" : `Las ${busyMatches} unidades están ocupadas`} ${onDates}.`,
      busy: true,
      dirtyAction: null,
    };
  }

  if (searchActive) {
    return {
      title:
        searchMatches === 1
          ? "La unidad que buscás no cumple los filtros"
          : "Las unidades que buscás no cumplen los filtros",
      body: `“${q}” coincide con ${countUnits(searchMatches)}, pero ${searchMatches === 1 ? "no cumple" : "ninguna cumple"} ${OTHER_FILTERS}.`,
      busy: false,
      dirtyAction: null,
    };
  }
  return {
    title: "Ninguna unidad coincide con los filtros",
    body: "Probá relajar los criterios o limpiá los filtros para volver a ver todas las unidades.",
    busy: false,
    dirtyAction: null,
  };
}
