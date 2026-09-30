"use client";

import { useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { dateToIso, isoToDate } from "@/lib/marketplace/dates";
import { countNights } from "@/lib/marketplace/pricing";
import {
  effectiveMinNights,
  isCalendarDayDisabled,
  isCalendarDayStruck,
  nextBlockedAfter,
  nightsLabel,
  resolveRangeSelection,
} from "@/lib/marketplace/widget-quote";
import { useListingStay } from "./stay-context";

/** Clases de marca para los días del calendario (tachado = noche ocupada). */
const CALENDAR_CLASSES = {
  struck: "[&>button]:line-through [&>button]:decoration-ink-400/70 [&>button]:text-ink-300",
};

/** Un mes (hoja de mobile): celdas de 44 px para el dedo. Dos meses (escritorio): 40 px. */
function cellSize(months: number): string {
  return months === 1 ? "[--cell-size:--spacing(11)]" : "[--cell-size:--spacing(10)]";
}

/**
 * Calendario de rango de la ficha (vista por noches).
 *
 * MANTIENE la lógica probada del widget anterior: noches ocupadas half-open,
 * checkout de recambio clickeable y nunca `excludeDisabled` (ver
 * src/lib/marketplace/widget-quote.ts, donde vive y se testea la regla).
 */
export function StayRangeCalendar({
  numberOfMonths = 1,
  onComplete,
  className,
}: {
  numberOfMonths?: number;
  /** Se llama cuando quedan elegidas llegada y salida. */
  onComplete?: () => void;
  className?: string;
}) {
  const { checkIn, checkOut, blocked, today, maxIso, setRange } = useListingStay();
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const maxDate = useMemo(() => isoToDate(maxIso), [maxIso]);
  const nextBlocked = useMemo(() => nextBlockedAfter(blocked, checkIn), [blocked, checkIn]);
  const state = { checkIn, checkOut, blocked, nextBlocked };

  const selected: DateRange | undefined = checkIn
    ? { from: isoToDate(checkIn), to: checkOut ? isoToDate(checkOut) : undefined }
    : undefined;

  function handleSelect(range: DateRange | undefined) {
    const next = resolveRangeSelection(
      range?.from ? dateToIso(range.from) : null,
      range?.to ? dateToIso(range.to) : null,
      blocked,
    );
    setRange(next.checkIn, next.checkOut);
    if (next.complete) onComplete?.();
  }

  return (
    <Calendar
      mode="range"
      locale={es}
      numberOfMonths={numberOfMonths}
      selected={selected}
      onSelect={handleSelect}
      defaultMonth={selected?.from ?? todayDate}
      startMonth={todayDate}
      endMonth={maxDate}
      disabled={[
        { before: todayDate },
        { after: maxDate },
        (date: Date) => isCalendarDayDisabled(dateToIso(date), state),
      ]}
      modifiers={{ struck: (date: Date) => isCalendarDayStruck(dateToIso(date), state) }}
      modifiersClassNames={CALENDAR_CLASSES}
      className={cn("mx-auto bg-transparent p-2", cellSize(numberOfMonths), className)}
    />
  );
}

/** Calendario de un día (vista por mes: "Desde"). Una noche ocupada no es llegada. */
export function StayStartCalendar({
  numberOfMonths = 1,
  onPick,
  className,
}: {
  numberOfMonths?: number;
  onPick?: () => void;
  className?: string;
}) {
  const { checkIn, blocked, today, maxIso, setMonthStart } = useListingStay();
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const maxDate = useMemo(() => isoToDate(maxIso), [maxIso]);
  const selected = checkIn ? isoToDate(checkIn) : undefined;

  return (
    <Calendar
      mode="single"
      locale={es}
      numberOfMonths={numberOfMonths}
      selected={selected}
      onSelect={(date) => {
        const iso = date ? dateToIso(date) : "";
        if (iso && blocked.has(iso)) return;
        setMonthStart(iso);
        if (iso) onPick?.();
      }}
      defaultMonth={selected ?? todayDate}
      startMonth={todayDate}
      endMonth={maxDate}
      disabled={[{ before: todayDate }, { after: maxDate }, (date: Date) => blocked.has(dateToIso(date))]}
      modifiers={{ struck: (date: Date) => blocked.has(dateToIso(date)) }}
      modifiersClassNames={CALENDAR_CLASSES}
      className={cn("mx-auto bg-transparent p-2", cellSize(numberOfMonths), className)}
    />
  );
}

/** Pie del calendario: referencias, noches elegidas, estado de la carga y "Limpiar". */
export function StayCalendarFooter({ className }: { className?: string }) {
  const { checkIn, checkOut, view, listing, blockedStatus, clearDates } = useListingStay();
  const nights = checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;
  // Con el rango completo, el mínimo que va a exigir el checkout (reglas de
  // TODAS las noches); sólo con la llegada, la pista de la noche de llegada.
  const min = effectiveMinNights(listing, checkIn || null, checkOut || null);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-cream-300 px-4 py-3 text-[0.8125rem] text-ink-500",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
        {blockedStatus === "loading" ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Cargando disponibilidad…
          </span>
        ) : blockedStatus === "error" ? (
          <span>No pudimos cargar la disponibilidad: te la confirmamos al pedir.</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-ink-300 line-through decoration-ink-400/70" aria-hidden>
              15
            </span>
            No disponible
          </span>
        )}
        {view === "noche" && min > 1 ? <span>Mínimo {nightsLabel(min)}</span> : null}
        {view === "noche" && nights > 0 ? <span className="font-semibold text-forest-700">{nightsLabel(nights)}</span> : null}
      </div>
      {checkIn || checkOut ? (
        <button
          type="button"
          onClick={clearDates}
          className="min-h-11 rounded-full px-2 font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
        >
          Limpiar fechas
        </button>
      ) : null}
    </div>
  );
}
