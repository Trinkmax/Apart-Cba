"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  MapPin,
  Calendar as CalendarIcon,
  Users,
  Minus,
  Plus,
} from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchRangeCalendar } from "@/components/marketplace/search-range-calendar";
import { formatDayLabel } from "@/lib/marketplace/dates";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";

function formatDateRange(checkIn: string | null, checkOut: string | null): string | null {
  const a = checkIn ? formatDayLabel(checkIn) : null;
  const b = checkOut ? formatDayLabel(checkOut) : null;
  if (a && b) return `${a} → ${b}`;
  if (a) return `Desde ${a}`;
  if (b) return `Hasta ${b}`;
  return null;
}

/* ───────────────────────── Compact search bar (header sticky) ───────────────────────── */

export function CompactSearchBar() {
  const router = useRouter();
  const t = useT();
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [datesOpen, setDatesOpen] = useState(false);

  function buildHref() {
    const params = new URLSearchParams();
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (guests > 1) params.set("huespedes", String(guests));
    const qs = params.toString();
    return `/buscar${qs ? `?${qs}` : ""}`;
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(buildHref());
  }

  const datesLabel = formatDateRange(checkIn, checkOut);
  const guestsLabel = guests > 1
    ? `${guests} ${t("search.guest_many")}`
    : t("header.guests");

  return (
    <form
      onSubmit={handleSearch}
      className="flex items-center rounded-full border border-neutral-200 shadow-sm hover:shadow-md transition-shadow bg-white overflow-hidden"
    >
      {/* Destino fijo — por ahora sólo operamos en Córdoba */}
      <div className="flex-1 min-w-0 px-4 py-2.5 flex items-center gap-1.5 text-sm font-medium text-neutral-900 whitespace-nowrap">
        <MapPin size={13} className="text-sage-600 shrink-0" strokeWidth={2.25} />
        Córdoba, Argentina
      </div>

      <Divider />

      {/* Fechas — siempre abre el calendario de rango */}
      <Popover open={datesOpen} onOpenChange={setDatesOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "hidden md:flex items-center px-4 py-2.5 text-sm whitespace-nowrap hover:bg-neutral-50 transition-colors",
              datesLabel ? "text-neutral-900 font-medium" : "text-neutral-500",
            )}
          >
            {datesLabel ?? t("header.any_date")}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          sideOffset={12}
          className="w-auto max-w-[calc(100vw-1.5rem)] p-0 max-h-[80vh] overflow-y-auto"
        >
          <SearchRangeCalendar
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(ci, co, complete) => {
              setCheckIn(ci);
              setCheckOut(co);
              if (complete) setDatesOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <Divider />

      {/* Huéspedes */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "hidden md:flex items-center px-4 py-2.5 text-sm whitespace-nowrap hover:bg-neutral-50 transition-colors",
              guests > 1 ? "text-neutral-900 font-medium" : "text-neutral-500",
            )}
          >
            {guestsLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={12} className="w-72 p-4">
          <GuestStepper
            label={t("search.guests")}
            value={guests}
            onChange={setGuests}
            min={1}
            max={20}
            unitOne={t("search.guest_one")}
            unitMany={t("search.guest_many")}
          />
        </PopoverContent>
      </Popover>

      <button
        type="submit"
        className="m-1.5 inline-flex items-center justify-center h-9 w-9 rounded-full bg-sage-500 text-white hover:bg-sage-600 transition-colors shrink-0"
        aria-label={t("search.cta")}
      >
        <Search size={16} />
      </button>
    </form>
  );
}

function Divider() {
  return <div className="hidden md:block self-stretch w-px bg-neutral-200" />;
}

function GuestStepper({
  label,
  value,
  onChange,
  min,
  max,
  unitOne,
  unitMany,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unitOne: string;
  unitMany: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
          {label}
        </div>
        <div className="text-sm text-neutral-700 mt-0.5">
          {value} {value === 1 ? unitOne : unitMany}
        </div>
      </div>
      <SymStepper value={value} onChange={onChange} min={min} max={max} />
    </div>
  );
}

/**
 * Stepper visualmente simétrico: dos botones idénticos en tamaño y centrado.
 */
function SymStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.max(min, value - 1));
        }}
        disabled={value <= min}
        aria-label="Disminuir"
        className="h-8 w-8 rounded-full border border-neutral-300 inline-flex items-center justify-center transition-all hover:border-neutral-900 hover:bg-neutral-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-current disabled:hover:border-neutral-300"
      >
        <Minus size={13} strokeWidth={2.5} className="shrink-0" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.min(max, value + 1));
        }}
        disabled={value >= max}
        aria-label="Aumentar"
        className="h-8 w-8 rounded-full border border-neutral-300 inline-flex items-center justify-center transition-all hover:border-neutral-900 hover:bg-neutral-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-current disabled:hover:border-neutral-300"
      >
        <Plus size={13} strokeWidth={2.5} className="shrink-0" />
      </button>
    </div>
  );
}

/* ───────────────────────── Hero search bar ───────────────────────── */

type FieldId = "llegada" | "salida" | "huespedes";

function Field({
  label,
  icon,
  isActive,
  onActivate,
  children,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onActivate: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "relative flex-1 px-5 md:px-6 py-2.5 md:py-3.5 cursor-pointer transition-all duration-200 focus:outline-none",
        "before:absolute before:inset-1 before:rounded-full before:transition-all before:duration-200",
        isActive
          ? "before:bg-white before:shadow-[0_6px_24px_-8px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.04)]"
          : "before:bg-transparent hover:before:bg-neutral-50/70",
        className,
      )}
    >
      <div className="relative z-10">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-700 flex items-center gap-1.5">
          <span className="text-sage-600 inline-flex">{icon}</span>
          {label}
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export function HeroSearchBar() {
  const router = useRouter();
  const t = useT();
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [activeField, setActiveField] = useState<FieldId | null>(null);
  const [calOpen, setCalOpen] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (guests > 1) params.set("huespedes", String(guests));
    const qs = params.toString();
    router.push(`/buscar${qs ? `?${qs}` : ""}`);
  }

  function openCalendar(field: "llegada" | "salida") {
    setActiveField(field);
    setCalOpen(true);
  }

  return (
    <form
      onSubmit={handleSearch}
      className="group/search relative flex flex-col md:flex-row items-stretch
                 rounded-3xl md:rounded-full bg-white
                 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.25),0_0_0_1px_rgb(0_0_0/0.04)]
                 border border-white/40
                 backdrop-blur-sm
                 overflow-hidden
                 divide-y md:divide-y-0 md:divide-x divide-neutral-200/60"
    >
      {/* Destino fijo — Córdoba. Un solo destino: mostrarlo como dato, no
          como input, le saca un paso (y una duda) al huésped. */}
      <div className="hidden md:flex flex-col justify-center px-6 py-3.5 select-none">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-700 flex items-center gap-1.5">
          <span className="text-sage-600 inline-flex">
            <MapPin size={11} strokeWidth={2.25} />
          </span>
          {t("search.destination")}
        </div>
        <div className="mt-0.5 text-[15px] text-neutral-900 whitespace-nowrap">
          Córdoba, Argentina
        </div>
      </div>

      {/* Fechas: tocar Llegada o Salida abre SIEMPRE el calendario de rango
          (nada de date-picker nativo, que en Safari ni siquiera se abre al
          click). El PopoverAnchor ancla el calendario bajo los dos campos. */}
      <Popover
        open={calOpen}
        onOpenChange={(open) => {
          setCalOpen(open);
          if (!open) setActiveField(null);
        }}
      >
        <PopoverAnchor asChild>
          <div className="flex flex-col md:flex-row md:flex-[2] divide-y md:divide-y-0 md:divide-x divide-neutral-200/60">
            <Field
              label={t("search.checkin")}
              icon={<CalendarIcon size={11} strokeWidth={2.25} />}
              isActive={calOpen && activeField === "llegada"}
              onActivate={() => openCalendar("llegada")}
            >
              <div className={cn("text-[15px]", checkIn ? "text-neutral-900" : "text-neutral-400")}>
                {checkIn ? formatDayLabel(checkIn) : t("header.any_date")}
              </div>
            </Field>

            <Field
              label={t("search.checkout")}
              icon={<CalendarIcon size={11} strokeWidth={2.25} />}
              isActive={calOpen && activeField === "salida"}
              onActivate={() => openCalendar("salida")}
            >
              <div className={cn("text-[15px]", checkOut ? "text-neutral-900" : "text-neutral-400")}>
                {checkOut ? formatDayLabel(checkOut) : t("header.any_date")}
              </div>
            </Field>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={10}
          className="w-auto max-w-[calc(100vw-1.5rem)] p-0 max-h-[80vh] overflow-y-auto"
        >
          <SearchRangeCalendar
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(ci, co, complete) => {
              setCheckIn(ci);
              setCheckOut(co);
              setActiveField(ci && !co ? "salida" : "llegada");
              if (complete) {
                setCalOpen(false);
                setActiveField(null);
              }
            }}
          />
        </PopoverContent>
      </Popover>

      <Field
        label={t("search.guests")}
        icon={<Users size={11} strokeWidth={2.25} />}
        isActive={activeField === "huespedes"}
        onActivate={() => setActiveField("huespedes")}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] text-neutral-700 tabular-nums whitespace-nowrap">
            {guests} {guests === 1 ? t("search.guest_one") : t("search.guest_many")}
          </span>
          <SymStepper
            value={guests}
            onChange={setGuests}
            min={1}
            max={20}
          />
        </div>
      </Field>

      <button
        type="submit"
        className="m-2 inline-flex items-center justify-center gap-2
                   h-12 md:h-auto md:min-w-[3.25rem] px-6 md:px-5
                   rounded-2xl md:rounded-full
                   bg-sage-600 hover:bg-sage-700 active:bg-sage-800
                   text-white font-semibold text-sm
                   shadow-[0_8px_24px_-12px_rgb(124_142_116/0.6)]
                   transition-all duration-200
                   hover:scale-[1.02] active:scale-[0.98]"
      >
        <Search size={18} strokeWidth={2.5} />
        <span className="md:hidden">{t("search.cta")}</span>
      </button>
    </form>
  );
}
