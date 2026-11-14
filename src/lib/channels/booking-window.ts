/**
 * Las marcas de la ventana de calendario de Booking.com: VEVENTs que no son
 * estadías sino el borde de lo que la propiedad tiene abierto para vender.
 *
 * Booking no distingue en su iCal una reserva de un cierre ("CLOSED - Not
 * available" para los dos), pero dos formas son inconfundibles:
 *
 *  · Larguísimo: nadie se aloja más de 120 noches por Booking. Es el tramo
 *    cerrado del final de la ventana, que el feed regenera con UID nuevo
 *    (BRASIL, Apart CBA: una "reserva" de 6 meses por día).
 *  · Lejísimo: el borde de la ventana (~18 meses, 547-549 días) llega como un
 *    VEVENT corto que se corre un día por día (BRASIL, COF II de Habitana,
 *    GAMA y SALGUERO de Viaggiato).
 *
 * Una sola definición para el lector del iCal (que decide cómo entran) y para
 * la política de avisos (que cierra lo que ya había entrado mal).
 */
export const LONG_RANGE_BLOCK_NIGHTS = 120;
export const BOOKING_WINDOW_EDGE_DAYS = 500;

/** Días entre dos fechas YYYY-MM-DD (b - a). */
export function daysBetweenYmd(a: string, b: string): number {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(x) || Number.isNaN(y)) return 0;
  return Math.round((y - x) / 86_400_000);
}

/** Más largo que cualquier estadía real: entra como cierre, no como reserva. */
export function isLongRangeMarker(checkIn: string, checkOut: string): boolean {
  return daysBetweenYmd(checkIn, checkOut) > LONG_RANGE_BLOCK_NIGHTS;
}

/** Empieza en el borde de la ventana, visto desde `seenOn`: no es una reserva. */
export function isWindowEdgeMarker(checkIn: string, seenOn: string): boolean {
  return daysBetweenYmd(seenOn, checkIn) >= BOOKING_WINDOW_EDGE_DAYS;
}

export function isBookingWindowMarker(
  stay: { checkIn: string; checkOut: string },
  seenOn: string,
): boolean {
  return isLongRangeMarker(stay.checkIn, stay.checkOut) || isWindowEdgeMarker(stay.checkIn, seenOn);
}
