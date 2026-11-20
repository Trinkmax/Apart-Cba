/**
 * Un cierre que Booking dejó de mostrar porque ya lo tiene NUESTRO calendario.
 *
 * Cofico Ideal, Habitana (19/11/2026): 16 preguntas «¿se canceló?» en tres
 * semanas sobre un solo departamento, y en 9 la respuesta fue «cancelar». Cada
 * entrada del calendario de Booking vivía entre una y dos horas. Cruzado con
 * las lecturas de nuestro calendario, las cinco que se pudieron medir
 * desaparecieron en la primera lectura posterior a que Booking se bajara el
 * nuestro (entre 30 s y 4 min y medio después):
 *
 *   aparece 15:40 → Booking lee el nuestro 16:55:42 → falta desde 16:58
 *   aparece 18:22 → lee 19:05:34 → falta desde 19:10
 *   aparece 20:38 → lee 22:04:44 → falta desde 22:08
 *   aparece 04:56 → lee 06:39:40 → falta desde 06:44
 *   aparece 11:56 → lee 13:07:36 → falta desde 13:08
 *
 * Una reserva de Booking no hace eso: se sigue publicando después de que
 * Booking lee nuestro calendario (lo hacen todas las demás conexiones, más de
 * 60 reservas publicadas a la vez). Lo que deja de publicarse son fechas
 * cerradas en Booking que no son una reserva suya —lo habitual es un cierre a
 * mano—: mientras nuestro calendario tenga esas mismas fechas, Booking no las
 * publica en el suyo.
 *
 * El cierre NO se borra en Booking. En GAMA (Viaggiato) cancelaron la reserva
 * local el 17/11 y Booking volvió a publicar la entrada. El 20/11 se vio
 * entero: entró a las 14:02, Booking leyó nuestro calendario a las 14:21:39 y
 * a las 14:26:08 ya no la publicaba.
 *
 * No se canceló nada, y preguntarlo era peor que ruido: contestar «cancelar»
 * liberaba acá fechas que en Booking siguen cerradas a propósito (quedaban a la
 * venta en la web propia y en las otras OTAs), y la entrada volvía a aparecer
 * en la lectura siguiente. Para abrirlas de verdad hay que abrirlas en Booking
 * Y cancelar la reserva acá.
 *
 * Qué se hace: la reserva queda como está y no se pregunta. Se deja una
 * novedad que explica por qué Booking dejó de mostrarlas y cómo se abren.
 * Puro; la lectura de los datos está en dispatch.ts.
 */
import type { Channel } from "./types";

/**
 * Cuánto después de la lectura de la OTA puede faltar la entrada para atribuir
 * la ausencia a esa lectura. Medido: hasta 4 min y medio. El barrido lee cada
 * 5-6 minutos, así que la primera lectura sin la entrada cae dentro de eso más
 * lo que tarde Booking en regenerar su calendario.
 */
export const ABSORBED_WINDOW_MS = 15 * 60 * 1000;

/**
 * La OTA tiene que haber leído nuestro calendario poco después de que la
 * reserva existiera (Booking lee cada 2 horas). Si la primera lectura que
 * tenemos anotada es de días después, el registro está incompleto —empezó el
 * 19/11/2026 y se purga a los 30 días— y no prueba nada.
 */
export const MAX_FIRST_READ_DELAY_MS = 6 * 60 * 60 * 1000;

export interface AbsorbedClosureFacts {
  channel: Channel;
  /** Cuándo se creó la reserva local: desde ahí está en nuestro calendario. */
  bookingCreatedAt: string | null | undefined;
  /** La reserva la cargó una persona (no salió de leer el calendario de la OTA). */
  bookingLoadedByPerson: boolean;
  /** La fila tiene número de reserva de la OTA: llegó su aviso «¡Nueva reserva!». */
  hasReservationNumber: boolean;
  /**
   * La PRIMERA vez que esa OTA se bajó nuestro calendario (respuesta 200)
   * después de que la reserva existiera.
   */
  firstReadAt: string | null | undefined;
  /** La primera lectura del calendario de la OTA en la que ya no estaba. */
  missingSince: string | null | undefined;
}

export function isAbsorbedByOurCalendar(f: AbsorbedClosureFacts): boolean {
  // Sólo se midió en Booking. Airbnb trae un UID por reserva y distingue sus
  // cierres («Airbnb (Not available)»).
  if (f.channel !== "booking") return false;
  // Una reserva cargada por una persona ya estaba en nuestro calendario antes
  // de que la OTA publicara nada: lo que pase con ella tiene su propio camino
  // (`isForeignHandLoadedBooking`).
  if (f.bookingLoadedByPerson) return false;
  // Con número es una reserva de Booking, no un cierre: si deja de publicarse
  // se pregunta como siempre, aunque coincida con una lectura.
  if (f.hasReservationNumber) return false;
  const created = parse(f.bookingCreatedAt);
  const read = parse(f.firstReadAt);
  const missing = parse(f.missingSince);
  if (created === null || read === null || missing === null) return false;
  if (read <= created || read - created > MAX_FIRST_READ_DELAY_MS) return false;
  const gap = missing - read;
  return gap >= 0 && gap <= ABSORBED_WINDOW_MS;
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
