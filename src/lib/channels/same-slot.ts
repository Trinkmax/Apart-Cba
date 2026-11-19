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

/** La reserva local de una fila de canal, como la lee el barrido. */
export interface LocalStay {
  status: string;
  cancelled_at: string | null;
}

/**
 * Cuánto tiene que seguir publicada la estadía después de que una persona
 * canceló la reserva local para tomarla como otra reserva. Si la OTA también
 * la canceló, su feed la saca en minutos (el 18/11/2026 Booking pasó una
 * reserva de SALGUERO a BALVA y el feed lo mostró en menos de 10): media hora
 * deja margen para que una cancelación en camino no vuelva a entrar.
 */
export const REFILL_GRACE_MS = 30 * 60 * 1000;

/**
 * El hueco se volvió a ocupar con LAS MISMAS FECHAS después de que una persona
 * canceló la reserva local, y la fila de canal sigue `active`.
 *
 * Pampa Mora, Habitana (18/11/2026): Rodolfo tenía del 4 al 6/12 por Booking,
 * canceló, y otra persona reservó exactamente esas noches. Booking publica el
 * mismo UID con las mismas fechas, así que su feed no cambió en nada. Cecilia
 * canceló la de Rodolfo esperando que entrara la nueva, pero el barrido sólo
 * vuelve a mirar una fila activa cuando cambian las fechas: las noches
 * quedaron libres en rentOS y vendidas en Booking.
 *
 * Sólo Booking (es el que reusa el UID; Airbnb trae uno por reserva) y sólo
 * con la llegada en el futuro: cancelar el mismo día de llegada o después es
 * un no-show o una salida anticipada, y volver a cargarla pondría una reserva
 * vacía sobre noches libres. Con otras fechas lo resuelve el paso 5b de la
 * ingesta.
 */
export function isRefilledAfterLocalCancel(
  reservation: Pick<
    ChannelReservationRow,
    "channel" | "external_status" | "booking_id" | "is_block" | "check_in" | "check_out"
  >,
  local: LocalStay | null | undefined,
  ev: { checkIn?: string | null; checkOut?: string | null; isBlock?: boolean },
  today: string,
  now: number = Date.now(),
): boolean {
  if (reservation.channel !== "booking") return false;
  if (reservation.external_status !== "active" || !reservation.booking_id) return false;
  if (reservation.is_block || ev.isBlock === true) return false;
  if (local?.status !== "cancelada" || !local.cancelled_at) return false;
  if (!reservation.check_in || ev.checkIn !== reservation.check_in || ev.checkOut !== reservation.check_out) {
    return false;
  }
  if (reservation.check_in <= today) return false;
  const cancelledAt = Date.parse(local.cancelled_at);
  return !Number.isNaN(cancelledAt) && now - cancelledAt >= REFILL_GRACE_MS;
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
 * siempre). Lo mismo sobre una fila activa cuya reserva local canceló una
 * persona (`localCancelled`, ver `isRefilledAfterLocalCancel`).
 */
export function dedupeKeyOverCancelled(
  baseKey: string,
  existing: Pick<ChannelReservationRow, "id" | "external_status"> | null | undefined,
  localCancelled = false,
): string {
  return existing && (existing.external_status === "cancelled" || localCancelled)
    ? `${baseKey}:sobre-cancelada:${existing.id}`
    : baseKey;
}

/**
 * El UID con el que queda archivada la fila vieja. Libera el UID real para la
 * reserva nueva (`uniq_channel_res_link_uid`) sin perder de dónde vino: nunca
 * coincide con un VEVENT, así que el barrido no la vuelve a mirar.
 */
export function archivedIcalUid(uid: string, reservationId: string): string {
  return `${uid}#${reservationId}`;
}

/**
 * Los huecos (UID + fechas) que ya se volvieron a cargar una vez, leídos de las
 * filas archivadas (que conservan las fechas de la estadía vieja). Si una
 * persona cancela también la reserva que entró sola, decide ella: un cierre de
 * Booking cancelado a mano en vez de marcado como cierre volvería cada media
 * hora.
 */
export function refilledSlots(
  rows: Array<Pick<ChannelReservationRow, "ical_uid" | "check_in" | "check_out">>,
): Set<string> {
  const slots = new Set<string>();
  for (const r of rows) {
    const cut = r.ical_uid?.indexOf("#") ?? -1;
    if (cut > 0) slots.add(slotKey(r.ical_uid!.slice(0, cut), r.check_in, r.check_out));
  }
  return slots;
}

export function slotKey(uid: string, checkIn: string | null, checkOut: string | null): string {
  return `${uid}|${checkIn ?? ""}|${checkOut ?? ""}`;
}
