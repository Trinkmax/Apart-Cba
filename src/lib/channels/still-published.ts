/**
 * ¿La OTA sigue publicando la estadía de esta reserva?
 *
 * Es la pregunta que hay que hacerse ANTES de cancelar a mano una reserva que
 * entró por un canal. Cancelarla acá no la cancela allá: si la OTA la sigue
 * teniendo, las noches quedan libres en el sistema —y en el calendario que leen
 * las demás OTAs— mientras ella las tiene ocupadas.
 *
 * Al 19/11/2026 había cinco reservas así, las cinco canceladas a mano:
 * SAL648 4→7/12 y CAS3 5→7/12 (Apart CBA), GAMA 26→27/11 (Viaggiato),
 * Pampa Mora 4→6/12 (Habitana) y DF-4 (Apart CBA). En CAS3, cinco días después
 * de cancelarla se vendió encima una estadía de dos meses por Airbnb.
 *
 * El barrido refresca `last_seen_at` una vez por hora mientras el evento sigue
 * en el feed, así que "vista hace menos de dos horas y sin ausencia en curso"
 * es "sigue publicada".
 */
export const STILL_PUBLISHED_WINDOW_MS = 2 * 60 * 60_000;

export interface PublishedRow {
  external_status: string;
  ical_uid: string | null;
  last_seen_at: string | null;
  missing_since: string | null;
  check_out: string | null;
  is_block?: boolean;
}

export function isStillPublished(row: PublishedRow, today: string, now: number = Date.now()): boolean {
  if (row.external_status !== "active" || !row.ical_uid || row.ical_uid.includes("#")) return false;
  if (row.missing_since || !row.last_seen_at) return false;
  // Una estadía que ya terminó sale sola del feed: no hay nada que vender dos veces.
  if (row.check_out && row.check_out <= today) return false;
  const seen = Date.parse(row.last_seen_at);
  return !Number.isNaN(seen) && now - seen <= STILL_PUBLISHED_WINDOW_MS;
}
