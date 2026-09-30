"use client";

import { cn } from "@/lib/utils";
import { BookingPanel } from "@/components/marketplace/listing/booking-panel";

/**
 * Widget de reserva de la ficha (columna derecha, sticky en escritorio).
 *
 * La lógica vive en `listing/stay-context.tsx` (estado compartido con la hoja
 * de mobile) y la cuenta en `src/lib/marketplace/widget-quote.ts` (testeada):
 * noches ocupadas half-open, checkout de recambio clickeable y nunca
 * `excludeDisabled` de react-day-picker. Se monta dentro de
 * `ListingStayProvider`.
 */
export function UnitBookingWidget({ className }: { className?: string }) {
  return (
    <section
      aria-label="Reservar este lugar"
      className={cn("rounded-3xl bg-paper p-6 shadow-apart-lg ring-1 ring-cream-300 xl:p-7", className)}
    >
      <BookingPanel variant="aside" />
    </section>
  );
}
