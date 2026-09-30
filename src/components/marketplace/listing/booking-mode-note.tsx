"use client";

import { CalendarRange, MessageCircleHeart, Zap } from "lucide-react";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { useListingStay } from "./stay-context";

/**
 * Cómo se reserva ESTA estadía: con confirmación, inmediata o, si es por mes
 * (unidad sólo mensual, pestaña "Por mes" o 28+ noches), por consulta. Lee la
 * vista del widget para no decir "pedís sin pagar" en una estadía que sólo se
 * puede consultar.
 */
export function BookingModeNote() {
  const { listing, settings, view, evaluation } = useListingStay();
  const monthly = view === "mes" || evaluation.kind === "monthly";
  const hours = hoursLabel(settings.responseHours);

  const { Icon, title, body } = monthly
    ? {
        Icon: CalendarRange,
        // "Estadías por mes" ya es el dato de al lado (KeyFacts): acá, cómo se reserva.
        title: "Se reserva por consulta",
        body: `Escribinos con las fechas y te pasamos el precio final, el contrato y la forma de pago en menos de ${hours}.`,
      }
    : listing.instant_book
      ? { Icon: Zap, title: "Reserva inmediata", body: "Queda confirmada al instante. Todavía no pagás nada." }
      : {
          Icon: MessageCircleHeart,
          title: "Reserva con confirmación",
          body: `Pedís sin pagar nada y te confirmamos en menos de ${hours}.`,
        };

  return (
    // m-rise: sube al entrar a la pantalla (sólo < lg, por scroll; en escritorio no hace nada).
    <div className="m-rise flex items-start gap-4 rounded-3xl bg-leaf-100 p-5 ring-1 ring-inset ring-leaf-300/60">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-paper text-forest-700 shadow-apart-sm">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-forest-700">{title}</p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-700">{body}</p>
      </div>
    </div>
  );
}
