"use client";

import { useState, useId } from "react";
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
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";

function formatDateInput(value: string | null): string {
  return value ?? "";
}

function formatDateLabel(value: string | null, locale = "es-AR"): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

function formatDateRange(checkIn: string | null, checkOut: string | null): string | null {
  const a = formatDateLabel(checkIn);
  const b = formatDateLabel(checkOut);
  if (a && b) return `${a} → ${b}`;
  if (a) return `Desde ${a}`;
  if (b) return `Hasta ${b}`;
  return null;
}

/* ───────────────────────── Compact search bar (header sticky) ───────────────────────── */

export function CompactSearchBar() {
  const router = useRouter();
  const t = useT();
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);

  const today = new Date().toISOString().slice(0, 10);

  function buildHref() {
    const params = new URLSearchParams();
    if (city.trim()) params.set("ciudad", city.trim());
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (guests > 1) params.set("huespedes", String(guests));
    return `/buscar?${params.toString()}`;
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
      {/* Destino */}
      <div className="flex-1 min-w-0 px-4 py-2.5">
        <input
          type="text"
          placeholder={t("header.search_placeholder")}
          className="w-full text-sm font-medium placeholder:text-neutral-400 focus:outline-none bg-transparent"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </div>

      <Divider />

      {/* Fechas */}
      <Popover>
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
        <PopoverContent align="center" sideOffset={12} className="w-80 p-4">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <DateField
                label={t("search.checkin")}
                value={checkIn}
                min={today}
                onChange={setCheckIn}
              />
              <DateField
                label={t("search.checkout")}
                value={checkOut}
                min={checkIn ?? today}
                onChange={setCheckOut}
              />
            </div>
            {(checkIn || checkOut) ? (
              <button
                type="button"
                onClick={() => {
                  setCheckIn(null);
                  setCheckOut(null);
                }}
                className="text-xs text-neutral-500 hover:text-neutral-900 underline"
              >
                Limpiar fechas
              </button>
            ) : null}
          </div>
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

function DateField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string | null;
  min?: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="block">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500 mb-1">
        {label}
      </div>
      <input
        type="date"
        min={min}
        value={formatDateInput(value)}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full h-10 px-3 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-900 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 outline-none transition"
      />
    </label>
  );
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

type FieldId = "destino" | "llegada" | "salida" | "huespedes";

function Field({
  id,
  label,
  icon,
  isActive,
  onActivate,
  children,
  className,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onActivate: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      onClick={onActivate}
      onFocus={onActivate}
      className={cn(
        "relative flex-1 px-5 md:px-6 py-2.5 md:py-3.5 cursor-text transition-all duration-200",
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
    </label>
  );
}

export function HeroSearchBar() {
  const router = useRouter();
  const t = useT();
  const baseId = useId();
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [activeField, setActiveField] = useState<FieldId | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (city.trim()) params.set("ciudad", city.trim());
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (guests > 1) params.set("huespedes", String(guests));
    router.push(`/buscar?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSearch}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setActiveField(null);
        }
      }}
      className="group/search relative flex flex-col md:flex-row items-stretch
                 rounded-3xl md:rounded-full bg-white
                 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.25),0_0_0_1px_rgb(0_0_0/0.04)]
                 border border-white/40
                 backdrop-blur-sm
                 overflow-hidden
                 divide-y md:divide-y-0 md:divide-x divide-neutral-200/60"
    >
      <Field
        id={`${baseId}-destino`}
        label={t("search.destination")}
        icon={<MapPin size={11} strokeWidth={2.25} />}
        isActive={activeField === "destino"}
        onActivate={() => setActiveField("destino")}
      >
        <input
          id={`${baseId}-destino`}
          type="text"
          className="w-full text-[15px] placeholder:text-neutral-400 focus:outline-none bg-transparent"
          placeholder={t("search.destination_placeholder")}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onFocus={() => setActiveField("destino")}
          autoComplete="off"
        />
      </Field>

      <Field
        id={`${baseId}-llegada`}
        label={t("search.checkin")}
        icon={<CalendarIcon size={11} strokeWidth={2.25} />}
        isActive={activeField === "llegada"}
        onActivate={() => setActiveField("llegada")}
      >
        <input
          id={`${baseId}-llegada`}
          type="date"
          className="w-full text-[15px] placeholder:text-neutral-400 focus:outline-none bg-transparent appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          min={today}
          value={formatDateInput(checkIn)}
          onChange={(e) => setCheckIn(e.target.value || null)}
          onFocus={() => setActiveField("llegada")}
        />
      </Field>

      <Field
        id={`${baseId}-salida`}
        label={t("search.checkout")}
        icon={<CalendarIcon size={11} strokeWidth={2.25} />}
        isActive={activeField === "salida"}
        onActivate={() => setActiveField("salida")}
      >
        <input
          id={`${baseId}-salida`}
          type="date"
          className="w-full text-[15px] placeholder:text-neutral-400 focus:outline-none bg-transparent appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          min={checkIn ?? today}
          value={formatDateInput(checkOut)}
          onChange={(e) => setCheckOut(e.target.value || null)}
          onFocus={() => setActiveField("salida")}
        />
      </Field>

      <Field
        id={`${baseId}-huespedes`}
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

