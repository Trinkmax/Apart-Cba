"use client";

import { CalendarPlus } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { buildStayIcs, icsFileName } from "./ics";

/**
 * "Agregar al calendario": arma el .ics en el navegador y lo descarga. En el
 * celular, abrir el archivo ofrece sumarlo a la agenda.
 */
export function AddToCalendarButton({
  uid,
  code,
  title,
  checkIn,
  checkOut,
  location,
  description,
  path,
  className,
}: {
  uid: string;
  code: string;
  title: string;
  checkIn: string;
  checkOut: string;
  location?: string | null;
  description?: string | null;
  /** Path del seguimiento; se agrega como link del evento. */
  path?: string | null;
  className?: string;
}) {
  function download() {
    const ics = buildStayIcs({
      uid,
      title,
      checkIn,
      checkOut,
      location,
      description,
      url: path ? `${window.location.origin}${path}` : null,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = icsFileName(code);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  return (
    <ApartButton type="button" variant="secondary" size="lg" onClick={download} className={className}>
      <CalendarPlus aria-hidden />
      Agregar al calendario
    </ApartButton>
  );
}
