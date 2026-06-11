"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Loader2, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ActiveFilter = {
  key: string;
  label: string;
};

export function SearchFiltersBar({
  totalResults,
  activeFilters,
}: {
  totalResults: number;
  activeFilters: ActiveFilter[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  // Navegar dentro de una transition mantiene la grilla actual visible
  // (con indicador sutil) en vez de flashear el loading.tsx completo.
  const [isPending, startTransition] = useTransition();

  function navigate(url: string) {
    startTransition(() => {
      router.push(url);
    });
  }

  function clearFilter(key: string) {
    const next = new URLSearchParams(params);
    next.delete(key);
    navigate(`/buscar?${next.toString()}`);
  }

  function clearAll() {
    navigate("/buscar");
  }

  const sort = params.get("orden") ?? "recommended";
  function changeSort(v: string) {
    const next = new URLSearchParams(params);
    if (v === "recommended") next.delete("orden");
    else next.set("orden", v);
    navigate(`/buscar?${next.toString()}`);
  }

  return (
    <div className="border-b border-neutral-200 bg-white sticky top-20 z-30">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 overflow-x-auto">
          <div
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium text-neutral-900 whitespace-nowrap transition-opacity",
              isPending && "opacity-60"
            )}
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin text-neutral-500" />
            ) : null}
            {totalResults} {totalResults === 1 ? "lugar" : "lugares"}
          </div>
          {activeFilters.length > 0 ? (
            <>
              <div className="h-4 w-px bg-neutral-200 mx-1" />
              <div
                className={cn(
                  "flex items-center gap-1.5 overflow-x-auto transition-opacity",
                  isPending && "opacity-60 pointer-events-none"
                )}
              >
                {activeFilters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => clearFilter(f.key)}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-100 hover:bg-neutral-200 text-xs font-medium text-neutral-700 transition-colors whitespace-nowrap"
                  >
                    {f.label}
                    <X size={12} />
                  </button>
                ))}
                <button
                  onClick={clearAll}
                  className="text-xs font-medium text-neutral-500 hover:text-neutral-900 underline underline-offset-2 px-2 whitespace-nowrap"
                >
                  Limpiar todo
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            value={sort}
            disabled={isPending}
            onChange={(e) => changeSort(e.target.value)}
            className="hidden md:block text-sm border border-neutral-300 rounded-full px-3 py-1.5 bg-white hover:border-neutral-700 focus:outline-none disabled:opacity-60"
          >
            <option value="recommended">Recomendado</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
            <option value="rating">Mejor calificados</option>
          </select>

          <button
            onClick={() => setOpen(!open)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
              open ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 hover:border-neutral-700"
            )}
          >
            <SlidersHorizontal size={14} />
            Filtros
          </button>
        </div>
      </div>

      {open ? <FilterPanel onClose={() => setOpen(false)} onNavigate={navigate} /> : null}
    </div>
  );
}

function FilterPanel({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (url: string) => void;
}) {
  const params = useSearchParams();

  const [bedrooms, setBedrooms] = useState<number | null>(
    params.get("ambientes") ? Number(params.get("ambientes")) : null
  );
  const [guests, setGuests] = useState<number | null>(
    params.get("huespedes") ? Number(params.get("huespedes")) : null
  );
  const [priceMin, setPriceMin] = useState<string>(params.get("precio_min") ?? "");
  const [priceMax, setPriceMax] = useState<string>(params.get("precio_max") ?? "");
  const [instant, setInstant] = useState<boolean>(params.get("instant") === "1");

  function apply() {
    const next = new URLSearchParams(params);
    if (bedrooms) next.set("ambientes", String(bedrooms));
    else next.delete("ambientes");
    if (guests) next.set("huespedes", String(guests));
    else next.delete("huespedes");
    if (priceMin) next.set("precio_min", priceMin);
    else next.delete("precio_min");
    if (priceMax) next.set("precio_max", priceMax);
    else next.delete("precio_max");
    if (instant) next.set("instant", "1");
    else next.delete("instant");
    onNavigate(`/buscar?${next.toString()}`);
    onClose();
  }

  return (
    <div className="border-t border-neutral-200 bg-neutral-50">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <div className="font-medium text-sm text-neutral-900">Ambientes</div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setBedrooms(bedrooms === n ? null : n)}
                className={cn(
                  "h-9 w-9 rounded-full border text-sm font-medium transition-colors",
                  bedrooms === n
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-300 hover:border-neutral-700"
                )}
              >
                {n === 5 ? "5+" : n}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-medium text-sm text-neutral-900">Huéspedes mínimo</div>
          <div className="flex gap-1.5">
            {[1, 2, 4, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => setGuests(guests === n ? null : n)}
                className={cn(
                  "h-9 px-3 rounded-full border text-sm font-medium transition-colors",
                  guests === n
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-300 hover:border-neutral-700"
                )}
              >
                {n}+
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-medium text-sm text-neutral-900">Precio por noche (ARS)</div>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              placeholder="Mín"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              className="w-24 h-9 px-3 rounded-lg border border-neutral-300 text-sm focus:border-neutral-700 outline-none"
            />
            <span className="text-neutral-400">—</span>
            <input
              type="number"
              placeholder="Máx"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              className="w-24 h-9 px-3 rounded-lg border border-neutral-300 text-sm focus:border-neutral-700 outline-none"
            />
          </div>
        </div>

        <div className="md:col-span-3">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={instant}
              onChange={(e) => setInstant(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300"
            />
            <span className="text-sm text-neutral-700">Solo reservas al toque (sin esperar aprobación)</span>
          </label>
        </div>

        <div className="md:col-span-3 flex justify-end gap-2 pt-3 border-t border-neutral-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            Cancelar
          </button>
          <button
            onClick={apply}
            className="px-5 py-2 rounded-full bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

void Filter;
