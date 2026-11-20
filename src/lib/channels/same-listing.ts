/**
 * El calendario del MISMO anuncio cargado en dos departamentos.
 *
 * El identificador (UID) que Booking y Airbnb ponen en cada entrada de su
 * calendario es propio del anuncio. Medido en producción (20/11/2026): 71
 * fechas de llegada aparecen en dos o más conexiones de Booking; en 69 cada
 * conexión tiene su UID, y en las 5 con el MISMO UID las dos conexiones leían
 * el mismo anuncio (ABASTO/BALVA, CENTRO/SALGUERO, LARRA/VELEZ y ACBA/VELEZ, las
 * cuatro en Viaggiato, que tiene 17 anuncios con la misma habitación
 * «Departamento de 1 dormitorio»).
 *
 * Así que si el calendario que se está por guardar trae una entrada que OTRA
 * conexión del mismo canal vio hace un rato, es el calendario del anuncio de
 * esa otra conexión: un anuncio no puede ser dos departamentos. Guardarlo
 * carga cada reserva en los dos (pasó con una estadía de $720.532 en ABASTO y
 * BALVA) y, en Booking, mata el enlace del otro.
 *
 * Sólo cuenta lo que la otra conexión vio hace poco: una fila vieja de un
 * error que ya se corrigió no puede frenar un enlace bueno. Puro.
 */

/**
 * `last_seen_at` de una fila se refresca una vez por hora mientras su entrada
 * siga en el calendario: tres horas alcanzan para «la está leyendo ahora» y
 * dejan afuera lo que quedó de un enlace anterior.
 */
export const SAME_LISTING_FRESH_MS = 3 * 60 * 60 * 1000;

/** Cuántos UIDs se consultan como mucho (van en la URL de la consulta). */
export const SAME_LISTING_MAX_UIDS = 80;

export interface OtherLinkRow {
  link_id: string | null;
  unit_id: string | null;
  ical_uid: string | null;
  check_in: string | null;
  check_out: string | null;
  last_seen_at: string | null;
}

export interface SameListingClash {
  linkId: string;
  unitId: string | null;
  /** Una entrada que traen los dos, de ejemplo. */
  checkIn: string | null;
  checkOut: string | null;
  /** Cuántas entradas comparten. */
  shared: number;
}

export function findSameListing(
  feedUids: string[],
  others: OtherLinkRow[],
  nowMs: number,
): SameListingClash | null {
  const uids = new Set(feedUids);
  const byLink = new Map<string, OtherLinkRow[]>();
  for (const r of others) {
    if (!r.link_id || !r.ical_uid || !uids.has(r.ical_uid) || !r.last_seen_at) continue;
    const seen = Date.parse(r.last_seen_at);
    if (Number.isNaN(seen) || nowMs - seen > SAME_LISTING_FRESH_MS) continue;
    const list = byLink.get(r.link_id);
    if (list) list.push(r);
    else byLink.set(r.link_id, [r]);
  }
  let best: OtherLinkRow[] | null = null;
  for (const rows of byLink.values()) {
    if (!best || rows.length > best.length) best = rows;
  }
  if (!best) return null;
  // De ejemplo, la entrada más próxima: es la que la persona reconoce.
  const example = [...best].sort((a, b) => (a.check_in ?? "9999").localeCompare(b.check_in ?? "9999"))[0];
  return {
    linkId: example.link_id as string,
    unitId: example.unit_id,
    checkIn: example.check_in,
    checkOut: example.check_out,
    shared: best.length,
  };
}
