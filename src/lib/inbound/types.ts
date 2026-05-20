export interface ResendInboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
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
