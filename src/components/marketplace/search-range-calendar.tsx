"use client";

import { useMemo } from "react";
import type { DateRange, DayButton } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { countNights, todayIsoAR } from "@/lib/marketplace/pricing";
import { dateToIso, isoToDate } from "@/lib/marketplace/dates";
import { cn } from "@/lib/utils";

export { useIsDesktop } from "@/components/marketplace/search/stepper";

/** Botón de día en píldora (la marca redondea todo). */
function ApartDayButton(props: React.ComponentProps<typeof DayButton>) {
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        "rounded-full font-apart text-[0.9375rem] font-medium",
        "data-[selected-single=true]:rounded-full data-[range-start=true]:rounded-full data-[range-end=true]:rounded-full",
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-forest-800",
        "hover:bg-leaf-100 hover:text-forest-700",
        props.className,
      )}
    />
  );
}

/** Clases de marca para el calendario de búsqueda (sin fechas bloqueadas). */
export function apartCalendarClassNames(stacked: boolean) {
  return {
    months: stacked ? "relative flex flex-col gap-8" : "relative flex flex-col gap-8 md:flex-row",
    month_caption: "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
    caption_label: "font-apart text-[0.9375rem] font-bold capitalize text-forest-700 select-none",
    weekday: "flex-1 select-none text-[0.75rem] font-semibold uppercase text-ink-500",
    range_start: "rounded-l-full bg-leaf-100",
    range_middle: "rounded-none bg-leaf-100",
    range_end: "rounded-r-full bg-leaf-100",
    today:
      "[&>button]:underline [&>button]:decoration-coral-500 [&>button]:decoration-2 [&>button]:underline-offset-4",
    disabled: "text-ink-300 opacity-60",
    outside: "invisible",
  };
}

function useCalendarBounds() {
  const today = useMemo(() => todayIsoAR(), []);
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const maxDate = useMemo(() => {
    const d = isoToDate(today);
    d.setMonth(d.getMonth() + 12);
    return d;
  }, [today]);
  return { todayDate, maxDate };
}

/**
 * Calendario de rango de los buscadores (hero, /buscar). Sin fechas
 * bloqueadas: acá se busca contra todo el inventario y la disponibilidad la
 * filtra el server. `stacked` = meses uno abajo del otro (hoja mobile).
 */
export function SearchRangeCalendar({
  checkIn,
  checkOut,
  onChange,
  months = 2,
  stacked = false,
  className,
}: {
  checkIn: string | null;
  checkOut: string | null;
  /** `complete` = true cuando el rango quedó cerrado (llegada y salida). */
  onChange: (checkIn: string | null, checkOut: string | null, complete: boolean) => void;
  months?: number;
  stacked?: boolean;
  className?: string;
}) {
  const { todayDate, maxDate } = useCalendarBounds();
  const selected: DateRange | undefined = checkIn
    ? { from: isoToDate(checkIn), to: checkOut ? isoToDate(checkOut) : undefined }
    : undefined;

  function handleSelect(range: DateRange | undefined, triggerDate: Date) {
    // Con un rango ya cerrado, un click nuevo empieza otra llegada (no estira el rango).
    if (checkIn && checkOut) {
      onChange(dateToIso(triggerDate), null, false);
      return;
    }
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
    <Calendar
      mode="range"
      locale={es}
      numberOfMonths={months}
      hideNavigation={stacked}
      selected={selected}
      onSelect={handleSelect}
      defaultMonth={stacked ? todayDate : (selected?.from ?? todayDate)}
      startMonth={todayDate}
      endMonth={maxDate}
      disabled={[{ before: todayDate }, { after: maxDate }]}
      showOutsideDays={false}
      classNames={apartCalendarClassNames(stacked)}
      components={{ DayButton: ApartDayButton }}
      className={cn("bg-transparent p-0 [--cell-size:2.75rem] md:[--cell-size:2.5rem]", className)}
    />
  );
}

/** Calendario de una fecha ("Desde", estadías por mes). */
export function SearchSingleCalendar({
  value,
  onChange,
  months = 1,
  stacked = false,
  className,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  months?: number;
  stacked?: boolean;
  className?: string;
}) {
  const { todayDate, maxDate } = useCalendarBounds();
  const selected = value ? isoToDate(value) : undefined;
  return (
    <Calendar
      mode="single"
      locale={es}
      numberOfMonths={months}
      hideNavigation={stacked}
      selected={selected}
      onSelect={(d) => onChange(d ? dateToIso(d) : null)}
      defaultMonth={stacked ? todayDate : (selected ?? todayDate)}
      startMonth={todayDate}
      endMonth={maxDate}
      disabled={[{ before: todayDate }, { after: maxDate }]}
      showOutsideDays={false}
      classNames={apartCalendarClassNames(stacked)}
      components={{ DayButton: ApartDayButton }}
      className={cn("bg-transparent p-0 [--cell-size:2.75rem] md:[--cell-size:2.5rem]", className)}
    />
  );
}

/** "3 noches" / "Elegí llegada y salida" para los pies de los calendarios. */
export function rangeNights(checkIn: string | null, checkOut: string | null): number {
  return checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;
}
