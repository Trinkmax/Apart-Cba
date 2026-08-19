export interface ResendInboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type ParsedEventType = "new_booking" | "cancellation" | "reference";

export interface ParsedBookingEvent {
  type: "new_booking";
  source: "airbnb" | "booking";
  externalId: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  totalAmount?: number;
  currency?: string;
  /** ID del listing en la OTA (Airbnb: número de listing, Booking: hotel_id). Si el parser lo extrae del email, el matcher hace lookup determinístico contra ota_listings antes del fuzzy. */
  externalListingId?: string;
  /** Texto libre del listing (nombre, título). Fallback fuzzy contra units.name/marketplace_title. */
  listingHint?: string;
}

export interface ParsedCancellationEvent {
  type: "cancellation";
  source: "airbnb" | "booking";
  externalId: string;
  /**
   * Fecha de llegada, cuando el email la trae. Booking la pone en el subject
   * ("¡Reserva cancelada! (6017858947, martes, 21 de julio de 2026)") y es la
   * única forma de encontrar la reserva local cuando ésta entró por iCal, que
   * no lleva número de reserva. Ver processCancellation en ingest.ts.
   */
  checkIn?: string;
}

/**
 * Aviso que identifica una reserva pero no alcanza para crearla: trae el número
 * de reserva y la fecha de llegada, sin check-out, unidad ni huésped.
 *
 * Es el "¡Nueva reserva!" de Booking.com. Antes se descartaba como ruido, y esa
 * era la razón de fondo por la que una cancelación de Booking nunca encontraba
 * su reserva: el iCal proyecta la reserva con `ical_uid` y sin número, el email
 * de cancelación llega con número y sin uid, y no había ningún momento en que
 * las dos identidades se cruzaran. Este evento es ese momento.
 */
export interface ParsedReferenceEvent {
  type: "reference";
  source: "airbnb" | "booking";
  externalId: string;
  checkIn: string;
  guestName?: string;
}

export type ParsedEvent =
  | ParsedBookingEvent
  | ParsedCancellationEvent
  | ParsedReferenceEvent;

export interface InboundEmailParser {
  name: string;
  canParse(from: string, subject: string): boolean;
  parse(email: ResendInboundEmail): ParsedEvent | null;
}
