import crypto from "crypto";
import { airbnbParser } from "@/lib/inbound/parsers/airbnb";
import { bookingParser } from "@/lib/inbound/parsers/booking";
import type { InboundEmailParser, ResendInboundEmail } from "@/lib/inbound/types";
import type { ReservationEvent } from "./types";

/**
 * IcalEmailAdapter — mitad email. Reusa los parsers de Airbnb/Booking y
 * convierte su salida al ReservationEvent canónico. El email NUNCA inserta
 * bookings directo: todo pasa por ingest.ts, igual que iCal.
 */

const PARSERS: InboundEmailParser[] = [airbnbParser, bookingParser];

export interface EmailNormalization {
  parserUsed: string | null;
  event: ReservationEvent | null;
  contentHash: string;
}

export function normalizeInboundEmail(input: {
  organizationId: string;
  providerMessageId: string;
  email: ResendInboundEmail;
}): EmailNormalization {
  const raw = input.email.html || input.email.text || "";
  const contentHash = crypto.createHash("sha256").update(raw).digest("hex");

  let parserUsed: string | null = null;
  let parsed: ReturnType<InboundEmailParser["parse"]> = null;
  for (const parser of PARSERS) {
    if (parser.canParse(input.email.from, input.email.subject)) {
      parsed = parser.parse(input.email);
      if (parsed) {
        parserUsed = parser.name;
        break;
      }
    }
  }

  if (!parsed) {
    return { parserUsed: null, event: null, contentHash };
  }

  // idempotencia por provider message ID — un reintento del webhook es no-op
  const dedupeKey = `email:${input.providerMessageId}`;

  if (parsed.type === "cancellation") {
    return {
      parserUsed,
      contentHash,
      event: {
        transport: "email",
        channel: parsed.source,
        eventType: "reservation_cancelled",
        organizationId: input.organizationId,
        confirmationCode: parsed.externalId,
        dedupeKey,
        contentHash,
      },
    };
  }

  return {
    parserUsed,
    contentHash,
    event: {
      transport: "email",
      channel: parsed.source,
      eventType: "reservation_upsert",
      organizationId: input.organizationId,
      confirmationCode: parsed.externalId,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      isBlock: false,
      guest: {
        name: parsed.guestName,
        email: parsed.guestEmail,
        phone: parsed.guestPhone,
      },
      amounts:
        parsed.totalAmount !== undefined
          ? { total: parsed.totalAmount, currency: parsed.currency }
          : undefined,
      listingId: parsed.externalListingId,
      listingHint: parsed.listingHint,
      dedupeKey,
      contentHash,
    },
  };
}
