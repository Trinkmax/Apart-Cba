"use client";

import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { stayLabel, type SearchMode, type SearchState } from "@/lib/marketplace/catalog-filter";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import { ResponsivePicker } from "./responsive-picker";
import { SearchEditorBody, SearchEditorFooter } from "./search-editor";
import { draftFromState, draftToState, useSearchDraft } from "./use-search-draft";

const MODE_LABELS = {
  noche: (
    <>
      <span className="sm:hidden">Noches</span>
      <span className="hidden sm:inline">Por noches</span>
    </>
  ),
  mes: (
    <>
      <span className="sm:hidden">Meses</span>
      <span className="hidden sm:inline">Por mes</span>
    </>
  ),
};

/**
 * Barra sticky de /buscar (debajo del header): la búsqueda resumida en una
 * píldora que abre el buscador completo, la pestaña Por noches / Por mes y el
 * botón "Filtros" con su contador.
 */
export function SearchToolbar({
  state,
  view,
  filterCount,
  onChange,
  onOpenFilters,
  editorOpen,
  onEditorOpenChange,
}: {
  state: SearchState;
  /** Vista efectiva (una búsqueda de 28+ noches se ve "por mes"). */
  view: SearchMode;
  filterCount: number;
  onChange: (next: SearchState) => void;
  onOpenFilters: () => void;
  /** El buscador de la píldora, controlado (el estado vacío lo abre con "Cambiar fechas"). */
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
}) {
  function changeMode(mode: SearchMode) {
    if (mode === view) return;
    if (mode === "noche" && state.mode === "noche") {
      // Estaba viendo "por mes" por una búsqueda larga: vuelve a noches sin fechas.
      onChange({ ...state, checkIn: null, checkOut: null, priceMax: null });
      return;
    }
    onChange(draftToState({ ...draftFromState(state), mode }, state));
  }

  return (
    <div className="sticky top-16 z-30 border-b border-cream-300 bg-cream/95 backdrop-blur-md supports-[backdrop-filter]:bg-cream/80 lg:top-[72px]">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8">
        <SearchPill
          state={state}
          onApply={onChange}
          open={editorOpen}
          onOpenChange={onEditorOpenChange}
          className="min-w-0 flex-1 sm:max-w-md"
        />
        <ModeToggle
          size="sm"
          value={view}
          onChange={changeMode}
          labels={MODE_LABELS}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={onOpenFilters}
          aria-label={filterCount > 0 ? `Filtros (${filterCount} activos)` : "Filtros"}
          aria-haspopup="dialog"
          className={cn(
            "relative inline-flex h-11 shrink-0 items-center gap-2 rounded-full border bg-paper font-apart text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors",
            "size-11 justify-center sm:w-auto sm:px-4",
            "hover:border-forest-700/45 focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
            filterCount > 0 ? "border-forest-700/60" : "border-cream-400",
            "sm:ml-auto",
          )}
        >
          <SlidersHorizontal aria-hidden className="size-[1.1rem]" />
          <span className="hidden sm:inline">Filtros</span>
          {filterCount > 0 ? (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-forest-700 text-[0.6875rem] font-bold text-cream sm:static"
            >
              {filterCount}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

/** La búsqueda resumida ("3–6 oct · 2 huéspedes"); abre el buscador completo. */
function SearchPill({
  state,
  onApply,
  open,
  onOpenChange,
  className,
}: {
  state: SearchState;
  onApply: (next: SearchState) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const { draft, setDraft, setMode, setDates, setStart, setMonths, setGuests } = useSearchDraft(
    draftFromState(state),
  );
  const handlers = { setMode, setDates, setStart, setMonths, setGuests };
  const { dates, guests } = stayLabel(state);

  // Cada vez que se abre (desde la píldora o desde afuera) arranca de la
  // búsqueda actual y descarta lo que no se aplicó.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(draftFromState(state));
  }

  function apply() {
    onApply(draftToState(draft, state));
    onOpenChange(false);
  }

  const trigger = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Cambiar búsqueda: ${dates ?? "sin fechas"}, ${guests ?? "sin huéspedes"}`}
      className={cn(
        "flex h-12 w-full min-w-0 items-center gap-2.5 rounded-full bg-paper pl-1.5 pr-4 text-left font-apart shadow-apart-sm ring-1 ring-cream-300 outline-none transition-shadow max-[399px]:pl-4",
        "hover:shadow-apart-md focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-coral-700 text-white max-[399px]:hidden">
        <Search aria-hidden className="size-4" strokeWidth={2.75} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className={cn("block truncate text-[0.875rem] font-bold", dates ? "text-ink-900" : "text-forest-700")}>
          {dates ?? "¿Cuándo venís?"}
        </span>
        <span className="block truncate text-[0.8125rem] text-ink-500">{guests ?? "Agregá huéspedes"}</span>
      </span>
    </button>
  );

  return (
    <div className={className}>
      <ResponsivePicker
        open={open}
        onOpenChange={onOpenChange}
        trigger={trigger}
        title="Tu búsqueda"
        description="Elegí fechas y cuántos son."
        desktop={<SearchEditorBody draft={draft} handlers={handlers} layout="desktop" onSubmit={apply} />}
        mobile={<SearchEditorBody draft={draft} handlers={handlers} layout="mobile" />}
        mobileFooter={<SearchEditorFooter draft={draft} onClear={() => setDates(null, null)} onSubmit={apply} />}
      />
    </div>
  );
}
