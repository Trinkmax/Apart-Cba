"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Calendar as CalendarIcon, Users, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

function formatDateInput(value: string | null): string {
  return value ?? "";
}

export function CompactSearchBar() {
  const router = useRouter();
  const [city, setCity] = useState("");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (city.trim()) params.set("ciudad", city.trim());
    router.push(`/buscar?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSearch}
      className="flex items-center rounded-full border border-neutral-200 shadow-sm hover:shadow-md transition-shadow bg-white overflow-hidden"
    >
      <div className="flex-1 px-4 py-2.5">
        <input
          type="text"
          placeholder="¿A dónde vamos?"
          className="w-full text-sm font-medium placeholder:text-neutral-400 focus:outline-none bg-transparent"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </div>
      <div className="hidden md:block px-3 text-xs text-neutral-400">·</div>
      <div className="hidden md:block px-4 py-2.5 text-sm text-neutral-500 whitespace-nowrap">
        Cualquier fecha
      </div>
      <div className="hidden md:block px-3 text-xs text-neutral-400">·</div>
      <div className="hidden md:block px-4 py-2.5 text-sm text-neutral-500 whitespace-nowrap">
        Huéspedes
      </div>
      <button
        type="submit"
        className="m-1.5 inline-flex items-center justify-center h-9 w-9 rounded-full bg-sage-500 text-white hover:bg-sage-600 transition-colors"
        aria-label="Buscar"
      >
        <Search size={16} />
      </button>
    </form>
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
        "relative flex-1 px-6 py-3.5 cursor-text transition-all duration-200",
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
        label="Destino"
        icon={<MapPin size={11} strokeWidth={2.25} />}
        isActive={activeField === "destino"}
        onActivate={() => setActiveField("destino")}
      >
        <input
          id={`${baseId}-destino`}
          type="text"
          className="w-full text-[15px] placeholder:text-neutral-400 focus:outline-none bg-transparent"
          placeholder="¿A dónde vas?"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onFocus={() => setActiveField("destino")}
          autoComplete="off"
        />
      </Field>

      <Field
        id={`${baseId}-llegada`}
        label="Llegada"
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
        label="Salida"
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
        label="Huéspedes"
        icon={<Users size={11} strokeWidth={2.25} />}
        isActive={activeField === "huespedes"}
        onActivate={() => setActiveField("huespedes")}
        className="flex items-center gap-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-neutral-700">
            {guests} {guests === 1 ? "huésped" : "huéspedes"}
          </span>
          <div className="flex items-center gap-1 -mr-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setGuests((g) => Math.max(1, g - 1));
              }}
              className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white grid place-items-center transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-current disabled:hover:border-neutral-300"
              aria-label="Disminuir huéspedes"
              disabled={guests <= 1}
            >
              <Minus size={12} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setGuests((g) => Math.min(20, g + 1));
              }}
              className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white grid place-items-center transition-all"
              aria-label="Aumentar huéspedes"
            >
              <Plus size={12} strokeWidth={2.5} />
            </button>
          </div>
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
        <span className="md:hidden">Buscar</span>
      </button>
    </form>
  );
}
