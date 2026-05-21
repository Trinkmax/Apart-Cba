export interface ResendInboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type ParsedEventType = "new_booking" | "cancellation";

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
}

export type ParsedEvent = ParsedBookingEvent | ParsedCancellationEvent;

export interface InboundEmailParser {
  name: string;
  canParse(from: string, subject: string): boolean;
  parse(email: ResendInboundEmail): ParsedEvent | null;
}
