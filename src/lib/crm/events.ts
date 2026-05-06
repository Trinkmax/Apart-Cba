"use server";

import { dispatchEvent, type DispatchEventInput } from "./workflows/dispatcher";

/**
 * Helper público para que server actions del PMS publiquen eventos
 * que pueden disparar workflows.
 *
 * Ejemplo de uso desde createBooking:
 *   await publishCrmEvent({
 *     organizationId: org.id,
 *     eventType: "booking.created",
 *     payload: { booking_id: booking.id, unit_id: booking.unit_id, guest_phone: ... },
 *     refType: "booking",
 *     refId: booking.id,
 *   });
 */
export async function publishCrmEvent(input: DispatchEventInput) {
  return dispatchEvent(input);
}
