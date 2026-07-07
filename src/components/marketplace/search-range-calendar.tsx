"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { countNights, todayIsoAR } from "@/lib/marketplace/pricing";
import { dateToIso, isoToDate } from "@/lib/marketplace/dates";

const DESKTOP_MQ = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP_MQ);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => false,
  );
}

/**
 * Calendario de rango de las barras de búsqueda (hero y compacta). El mismo
 * look & feel que el widget de reserva, pero sin fechas bloqueadas: acá se
 * busca contra todo el inventario, la disponibilidad la filtra el server.
 */
export function SearchRangeCalendar({
  checkIn,
  checkOut,
  onChange,
}: {
  checkIn: string | null;
  checkOut: string | null;
  /** `complete` = true cuando el rango quedó cerrado (llegada y salida). */
  onChange: (checkIn: string | null, checkOut: string | null, complete: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  const today = useMemo(() => todayIsoAR(), []);
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const maxDate = useMemo(() => {
    const d = isoToDate(today);
    d.setMonth(d.getMonth() + 12);
    return d;
  }, [today]);

  const selected: DateRange | undefined = checkIn
    ? { from: isoToDate(checkIn), to: checkOut ? isoToDate(checkOut) : undefined }
    : undefined;

  const nights =
    checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) {
      onChange(null, null, false);
      return;
    }
    const fromIso = dateToIso(range.from);
    const toIso = range.to ? dateToIso(range.to) : "";
    // from === to es el primer click: todavía no hay salida elegida.
    const complete = Boolean(toIso && toIso !== fromIso);
    onChange(fromIso, complete ? toIso : null, complete);
  }

  return (
    <div>
      <Calendar
        mode="range"
        locale={es}
        numberOfMonths={isDesktop ? 2 : 1}
        selected={selected}
        onSelect={handleSelect}
        defaultMonth={selected?.from ?? todayDate}
        startMonth={todayDate}
        endMonth={maxDate}
        disabled={[{ before: todayDate }, { after: maxDate }]}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-neutral-200 px-4 py-2.5 text-xs text-neutral-500">
        <span className={nights > 0 ? "font-medium text-neutral-700" : ""}>
          {nights > 0
            ? `${nights} ${nights === 1 ? "noche" : "noches"}`
            : "Elegí llegada y salida"}
        </span>
        {checkIn || checkOut ? (
          <button
            type="button"
            onClick={() => onChange(null, null, false)}
            className="underline underline-offset-2 hover:text-neutral-900"
          >
            Limpiar fechas
          </button>
        ) : null}
      </div>
    </div>
  );
}
