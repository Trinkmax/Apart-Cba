"use client";

import { useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import {
  SearchRangeCalendar,
  SearchSingleCalendar,
  rangeNights,
} from "@/components/marketplace/search-range-calendar";
import {
  MAX_GUESTS_FILTER,
  MAX_MONTHS,
  guestsCountLabel,
  monthsLabel,
  nightsLabel,
  shortDateLabel,
} from "@/lib/marketplace/catalog-filter";
import { isMonthlyStay } from "@/lib/marketplace/stay";
import { cn } from "@/lib/utils";
import { FieldButton, ResponsivePicker } from "./responsive-picker";
import { Stepper, useIsDesktop } from "./stepper";

/** Cuántos meses se ven apilados en la hoja mobile (hoy + 12 meses). */
const MOBILE_MONTHS = 13;

function rangeStatus(checkIn: string | null, checkOut: string | null): string {
  const nights = rangeNights(checkIn, checkOut);
  if (nights > 0) return nightsLabel(nights);
  return checkIn ? "Elegí la salida" : "Elegí la llegada";
}

function MonthlyHint({ nights }: { nights: number }) {
  if (!isMonthlyStay(nights)) return null;
  return (
    <p className="text-[0.8125rem] text-ink-600">
      Para 28 noches o más te mostramos estadías por mes: se consultan.
    </p>
  );
}

/**
 * Llegada · Salida: dos campos que abren UN selector de rango (Popover con 2
 * meses en desktop; hoja a pantalla completa con los meses apilados en mobile).
 */
export function DatesField({
  checkIn,
  checkOut,
  onChange,
  open,
  onOpenChange,
  onComplete,
  className,
  fieldClassName,
}: {
  checkIn: string | null;
  checkOut: string | null;
  onChange: (checkIn: string | null, checkOut: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama al cerrar un rango en desktop (p. ej. para pasar a huéspedes). */
  onComplete?: () => void;
  className?: string;
  fieldClassName?: string;
}) {
  const isDesktop = useIsDesktop();
  const nights = rangeNights(checkIn, checkOut);

  function handleCalendar(ci: string | null, co: string | null, complete: boolean) {
    onChange(ci, co);
    if (complete && isDesktop) {
      onOpenChange(false);
      onComplete?.();
    }
  }

  const clear = (
    <button
      type="button"
      onClick={() => onChange(null, null)}
      disabled={!checkIn}
      className="rounded-full px-1 text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 outline-none hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 disabled:no-underline disabled:opacity-40"
    >
      Borrar fechas
    </button>
  );

  const trigger = (
    <div className={cn("grid grid-cols-2", className)}>
      <FieldButton
        label="Llegada"
        value={checkIn ? shortDateLabel(checkIn, { weekday: true }) : null}
        placeholder="Agregá fecha"
        icon={<CalendarDays aria-hidden className="size-5" />}
        active={open && !checkIn}
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={fieldClassName}
      />
      <FieldButton
        label="Salida"
        value={checkOut ? shortDateLabel(checkOut, { weekday: true }) : null}
        placeholder="Agregá fecha"
        active={open && Boolean(checkIn)}
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={fieldClassName}
      />
    </div>
  );

  return (
    <ResponsivePicker
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title="¿Cuándo venís?"
      description="Elegí la llegada y la salida."
      desktop={
        <div className="w-[38rem] max-w-full">
          <p aria-live="polite" className="mb-3 font-apart text-[0.9375rem] font-bold text-forest-700">
            {rangeStatus(checkIn, checkOut)}
          </p>
          <SearchRangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={handleCalendar} months={2} />
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-cream-300 pt-3">
            {clear}
            <MonthlyHint nights={nights} />
            <ApartButton type="button" size="md" onClick={() => onOpenChange(false)}>
              Listo
            </ApartButton>
          </div>
        </div>
      }
      mobile={
        <SearchRangeCalendar
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={handleCalendar}
          months={MOBILE_MONTHS}
          stacked
          className="mx-auto"
        />
      }
      mobileFooter={
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p aria-live="polite" className="font-apart text-[0.9375rem] font-bold text-forest-700">
              {rangeStatus(checkIn, checkOut)}
            </p>
            {isMonthlyStay(nights) ? <MonthlyHint nights={nights} /> : clear}
          </div>
          <ApartButton type="button" size="lg" onClick={() => onOpenChange(false)}>
            Listo
          </ApartButton>
        </div>
      }
    />
  );
}

/** Popover controlado o no (si no se pasa `open`, maneja su propio estado). */
function useMaybeControlled(open?: boolean, onOpenChange?: (open: boolean) => void) {
  const [inner, setInner] = useState(false);
  return [open ?? inner, onOpenChange ?? setInner] as const;
}

const POPOVER_CLASS = "w-[22rem] max-w-[calc(100vw-2rem)] rounded-3xl border-cream-300 bg-paper p-5 font-apart shadow-apart-lg";

/** Huéspedes: campo que abre un popover con el contador (1–12). */
export function GuestsField({
  value,
  onChange,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  align = "end",
  className,
}: {
  value: number | null;
  onChange: (guests: number | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useMaybeControlled(openProp, onOpenChangeProp);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FieldButton
          label="Huéspedes"
          value={value ? guestsCountLabel(value) : null}
          placeholder="¿Cuántos son?"
          icon={<Users aria-hidden className="size-5" />}
          active={open}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={10} aria-label="Huéspedes" className={POPOVER_CLASS}>
        <GuestsStepper value={value} onChange={onChange} />
        <div className="mt-4 flex items-center justify-between border-t border-cream-300 pt-3">
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={value == null}
            className="rounded-full px-1 text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 outline-none hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 disabled:no-underline disabled:opacity-40"
          >
            Sin definir
          </button>
          <ApartButton type="button" size="md" onClick={() => setOpen(false)}>
            Listo
          </ApartButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** El contador de huéspedes solo (también lo usan el editor de /buscar y los filtros). */
export function GuestsStepper({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (guests: number) => void;
  className?: string;
}) {
  return (
    <Stepper
      label="Huéspedes"
      hint="Contá a todos, también a los chicos."
      value={value ?? 1}
      onChange={onChange}
      min={1}
      max={MAX_GUESTS_FILTER}
      format={guestsCountLabel}
      decLabel="Restar un huésped"
      incLabel="Sumar un huésped"
      className={className}
    />
  );
}

/** Estadías por mes: "Desde" (calendario de una fecha). */
export function MonthStartField({
  value,
  onChange,
  open,
  onOpenChange,
  onComplete,
  className,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  className?: string;
}) {
  function pick(iso: string | null) {
    onChange(iso);
    if (iso) {
      onOpenChange(false);
      onComplete?.();
    }
  }
  return (
    <ResponsivePicker
      open={open}
      onOpenChange={onOpenChange}
      title="¿Desde cuándo?"
      description="Elegí el día de llegada."
      trigger={
        <FieldButton
          label="Desde"
          value={value ? shortDateLabel(value, { weekday: true }) : null}
          placeholder="Agregá fecha"
          icon={<CalendarDays aria-hidden className="size-5" />}
          active={open}
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          className={className}
        />
      }
      desktop={<SearchSingleCalendar value={value} onChange={pick} months={1} />}
      mobile={<SearchSingleCalendar value={value} onChange={pick} months={MOBILE_MONTHS} stacked className="mx-auto" />}
    />
  );
}

/** Estadías por mes: cuántos meses (1–12). */
export function MonthsCountField({
  value,
  onChange,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  className,
}: {
  value: number;
  onChange: (months: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useMaybeControlled(openProp, onOpenChangeProp);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FieldButton
          label="Cuántos meses"
          value={monthsLabel(value)}
          placeholder="1 mes"
          active={open}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} aria-label="Cuántos meses" className={POPOVER_CLASS}>
        <MonthsStepper value={value} onChange={onChange} />
        <div className="mt-4 flex justify-end border-t border-cream-300 pt-3">
          <ApartButton type="button" size="md" onClick={() => setOpen(false)}>
            Listo
          </ApartButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MonthsStepper({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (months: number) => void;
  className?: string;
}) {
  return (
    <Stepper
      label="Cuántos meses"
      hint="El precio por mes se consulta con el equipo."
      value={value}
      onChange={onChange}
      min={1}
      max={MAX_MONTHS}
      format={monthsLabel}
      decLabel="Restar un mes"
      incLabel="Sumar un mes"
      className={className}
    />
  );
}
