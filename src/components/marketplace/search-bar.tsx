"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Calendar as CalendarIcon, Users } from "lucide-react";

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

export function HeroSearchBar() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);

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
      className="flex flex-col md:flex-row items-stretch rounded-3xl md:rounded-full bg-white shadow-xl border border-neutral-200/60 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-neutral-200"
    >
      <label className="flex-1 px-6 py-4 hover:bg-neutral-50 transition-colors cursor-text">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 flex items-center gap-1.5">
          <MapPin size={11} className="text-sage-500" />
          Destino
        </div>
        <input
          type="text"
          className="w-full text-sm placeholder:text-neutral-400 focus:outline-none bg-transparent mt-1"
          placeholder="¿A dónde vas?"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </label>

      <label className="flex-1 px-6 py-4 hover:bg-neutral-50 transition-colors cursor-text">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 flex items-center gap-1.5">
          <CalendarIcon size={11} className="text-sage-500" />
          Llegada
        </div>
        <input
          type="date"
          className="w-full text-sm placeholder:text-neutral-400 focus:outline-none bg-transparent mt-1"
          min={today}
          value={formatDateInput(checkIn)}
          onChange={(e) => setCheckIn(e.target.value || null)}
        />
      </label>

      <label className="flex-1 px-6 py-4 hover:bg-neutral-50 transition-colors cursor-text">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 flex items-center gap-1.5">
          <CalendarIcon size={11} className="text-sage-500" />
          Salida
        </div>
        <input
          type="date"
          className="w-full text-sm placeholder:text-neutral-400 focus:outline-none bg-transparent mt-1"
          min={checkIn ?? today}
          value={formatDateInput(checkOut)}
          onChange={(e) => setCheckOut(e.target.value || null)}
        />
      </label>

      <label className="flex-1 px-6 py-4 hover:bg-neutral-50 transition-colors cursor-text flex items-center gap-4">
        <div className="flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 flex items-center gap-1.5">
            <Users size={11} className="text-sage-500" />
            Huéspedes
          </div>
          <div className="text-sm text-neutral-700 mt-1">
            {guests} {guests === 1 ? "huésped" : "huéspedes"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setGuests((g) => Math.max(1, g - 1))}
            className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-700 grid place-items-center text-sm"
            aria-label="Disminuir huéspedes"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setGuests((g) => Math.min(20, g + 1))}
            className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-700 grid place-items-center text-sm"
            aria-label="Aumentar huéspedes"
          >
            +
          </button>
        </div>
      </label>

      <button
        type="submit"
        className="m-2 md:m-2 inline-flex items-center gap-2 px-6 md:px-5 py-3 md:py-0 rounded-2xl md:rounded-full bg-sage-500 hover:bg-sage-600 text-white font-medium transition-colors"
      >
        <Search size={18} />
        <span className="md:hidden">Buscar</span>
      </button>
    </form>
  );
}
