/**
 * Una reserva nueva en un hueco que ya tuvo otra.
 *
 * Booking.com arma el UID de su iCal con la habitación y la FECHA DE LLEGADA,
 * no con la reserva. Medido en producción (14/11/2026) sobre 320 UIDs de
 * Booking: ninguno cambió nunca de llegada y 41 cambiaron sólo la salida. Si
 * alguien cancela y otra persona reserva desde el mismo día, el feed publica el
 * MISMO UID con la estadía nueva.
 *
 * El pipeline lo trataba como la reserva cancelada "que volvía": abría un aviso
 * ("verificá el estado en la OTA") y no cargaba nada. La reserva nueva no
 * aparecía y las fechas quedaban libres para venderse otra vez (Habitana,
 * Pampa Mora 25→27/11/2026: Cecilia la cargó a mano; había 18 filas iguales
 * entre Habitana, Viaggiato y Apart CBA).
 *
 * Esto decide si un VEVENT vivo que cae sobre una reserva externa ya terminada
 * (su fila cancelada, o su reserva local cancelada por una persona) es una
 * estadía NUEVA. La reserva cancelada no se toca: queda como historia, y la
 * nueva entra por el camino de siempre (se vincula a una cargada a mano con las
 * mismas fechas, o se crea, o choca y abre un conflicto visible).
 */
import { isBookingWindowMarker } from "./booking-window";
import type { Channel, ChannelReservationRow, ChannelTransport } from "./types";

export interface SlotEvent {
  channel: Channel;
  transport: ChannelTransport;
  isBlock?: boolean;
  /** Ya normalizado con `normalizeRef`. */
  confirmationCode?: string | null;
}

type SlotReservation = Pick<
  ChannelReservationRow,
  "is_block" | "confirmation_code" | "check_in" | "check_out" | "created_at"
>;

export function isNewStayInSameSlot(reservation: SlotReservation, ev: SlotEvent): boolean {
  // Sólo el feed: un mail trae su propio número y tiene su propio camino.
  if (ev.transport !== "ical") return false;

  // Un cierre de fechas no es una estadía: que la OTA lo siga publicando no
  // trae a nadie (los cierres de GAMA y SALGUERO que Booking corre día por día).
  if (ev.isBlock === true || reservation.is_block) return false;

  // Mismo número de reserva: es la MISMA reserva que la OTA volvió a activar
  // (Airbnb publica el código en el feed). Eso lo decide una persona.
  if (
    ev.confirmationCode &&
    reservation.confirmation_code &&
    ev.confirmationCode === reservation.confirmation_code
  ) {
    return false;
  }

  // Una marca del borde de la ventana de Booking que alguien ya descartó vuelve
  // a entrar al rango con el paso de los días: no es una reserva.
  if (
    ev.channel === "booking" &&
    reservation.check_in &&
    reservation.check_out &&
    isBookingWindowMarker(
      { checkIn: reservation.check_in, checkOut: reservation.check_out },
      reservation.created_at.slice(0, 10),
    )
  ) {
    return false;
  }

  return true;
}

/**
 * La clave de deduplicación de un VEVENT que cae sobre una fila cancelada.
 *
 * El evento ya procesado de la reserva cancelada tiene el mismo contenido que
 * el de una persona que reservó EXACTAMENTE las mismas fechas (mismo UID,
 * mismas fechas): con la clave de siempre la ingesta lo daba por repetido y
 * nunca lo miraba — ni siquiera abría el aviso. Pasaba en AT4B, Villa del Prado
 * y Cofico de Habitana. Sobre una fila cancelada, el evento se deduplica aparte
 * (una vez por fila: después de archivarla, la fila nueva vuelve a la clave de
 * siempre).
 */
export function dedupeKeyOverCancelled(
  baseKey: string,
  existing: Pick<ChannelReservationRow, "id" | "external_status"> | null | undefined,
): string {
  return existing?.external_status === "cancelled" ? `${baseKey}:sobre-cancelada:${existing.id}` : baseKey;
}

/**
 * El UID con el que queda archivada la fila vieja. Libera el UID real para la
 * reserva nueva (`uniq_channel_res_link_uid`) sin perder de dónde vino: nunca
 * coincide con un VEVENT, así que el barrido no la vuelve a mirar.
 */
export function archivedIcalUid(uid: string, reservationId: string): string {
  return `${uid}#${reservationId}`;
}
