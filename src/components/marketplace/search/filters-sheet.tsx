"use client";

import { useId, useState } from "react";
import { X, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { BEDROOM_OPTIONS, type SearchMode, type SearchState } from "@/lib/marketplace/catalog-filter";
import { cn } from "@/lib/utils";
import { GuestsStepper } from "./search-fields";
import { useIsDesktop } from "./stepper";

type FiltersDraft = Pick<SearchState, "bedrooms" | "guests" | "priceMax" | "instant">;

const BEDROOM_LABEL: Record<(typeof BEDROOM_OPTIONS)[number], string> = {
  0: "Mono",
  1: "1",
  2: "2",
  3: "3 o más",
};

const moneyFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

function formatThousands(n: number | null): string {
  return n ? moneyFmt.format(n) : "";
}

function parseThousands(raw: string): number | null {
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  const n = digits ? Number(digits) : 0;
  return n > 0 ? n : null;
}

function placesLabel(n: number): string {
  return n === 1 ? "Mostrar 1 lugar" : `Mostrar ${n} lugares`;
}

/**
 * Panel "Filtros" de /buscar: dormitorios, huéspedes, precio máximo (de la
 * pestaña) y reserva inmediata. Trabaja sobre un borrador y el botón
 * "Mostrar N lugares" cuenta en vivo con `countFor`.
 */
export function FiltersSheet({
  open,
  onOpenChange,
  state,
  view,
  countFor,
  onApply,
  priceHint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SearchState;
  view: SearchMode;
  countFor: (next: SearchState) => number;
  onApply: (next: SearchState) => void;
  /** "Entre $ 45.000 y $ 120.000 por noche" (opcional). */
  priceHint?: string | null;
}) {
  const isDesktop = useIsDesktop();
  const [draft, setDraft] = useState<FiltersDraft>(() => pick(state));
  const [lastOpen, setLastOpen] = useState(open);
  // Al abrir, el borrador vuelve a la búsqueda actual (patrón "estado derivado").
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(pick(state));
  }

  const next: SearchState = { ...state, ...draft };
  const count = countFor(next);
  const priceId = useId();

  function apply() {
    onApply(next);
    onOpenChange(false);
  }

  function clear() {
    setDraft({ bedrooms: null, guests: null, priceMax: null, instant: false });
  }

  const dirty =
    draft.bedrooms != null || draft.priceMax != null || draft.instant || (draft.guests != null && draft.guests > 1);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        showCloseButton={false}
        className={cn(
          "gap-0 border-cream-300 bg-cream p-0 font-apart",
          isDesktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-cream-300 px-5 py-3">
          <div>
            <SheetTitle className="font-apart text-xl font-extrabold tracking-[-0.02em] text-forest-700">
              Filtros
            </SheetTitle>
            <SheetDescription className="sr-only">
              Afiná la búsqueda por dormitorios, huéspedes, precio y tipo de reserva.
            </SheetDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar filtros"
            className="grid size-11 place-items-center rounded-full text-forest-700 outline-none hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <section aria-labelledby={`${priceId}-bed`} className="pb-6">
            <h3 id={`${priceId}-bed`} className="text-[0.9375rem] font-bold text-ink-900">
              Dormitorios
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {BEDROOM_OPTIONS.map((b) => {
                const active = draft.bedrooms === b;
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={active}
                    aria-label={b === 0 ? "Monoambiente" : b === 3 ? "3 dormitorios o más" : `${b} dormitorio${b === 1 ? "" : "s"}`}
                    onClick={() => setDraft((d) => ({ ...d, bedrooms: active ? null : b }))}
                    className={cn(
                      "h-11 min-w-[3.5rem] rounded-full border px-4 text-[0.9375rem] font-semibold outline-none transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                      active
                        ? "border-forest-700 bg-forest-700 text-cream"
                        : "border-cream-400 bg-paper text-ink-800 hover:border-forest-700/45",
                    )}
                  >
                    {BEDROOM_LABEL[b]}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[0.8125rem] text-ink-500">Mono = monoambiente (un solo ambiente).</p>
          </section>

          <section className="border-t border-cream-300 py-6">
            <GuestsStepper
              value={draft.guests}
              onChange={(g) => setDraft((d) => ({ ...d, guests: g }))}
            />
          </section>

          <section className="border-t border-cream-300 py-6">
            <label htmlFor={`${priceId}-price`} className="text-[0.9375rem] font-bold text-ink-900">
              Precio máximo {view === "mes" ? "por mes" : "por noche"}
            </label>
            <div className="relative mt-3">
              <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-500">
                $
              </span>
              <input
                id={`${priceId}-price`}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Sin tope"
                value={formatThousands(draft.priceMax)}
                onChange={(e) => setDraft((d) => ({ ...d, priceMax: parseThousands(e.target.value) }))}
                aria-describedby={`${priceId}-price-hint`}
                className="h-12 w-full rounded-2xl border border-cream-400 bg-paper pl-9 pr-4 font-apart text-base tabular-nums text-ink-900 outline-none placeholder:text-ink-400 focus-visible:border-forest-600 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
              />
            </div>
            <p id={`${priceId}-price-hint`} className="mt-2 text-[0.8125rem] leading-snug text-ink-500">
              {view === "mes"
                ? "Las unidades sin precio por mes cargado quedan afuera con un tope."
                : "Con fechas comparamos el promedio por noche."}
              {priceHint ? ` ${priceHint}` : ""}
            </p>
          </section>

          {view === "noche" ? (
            <section className="border-t border-cream-300 pt-6">
              <button
                type="button"
                role="switch"
                aria-checked={draft.instant}
                onClick={() => setDraft((d) => ({ ...d, instant: !d.instant }))}
                className="flex w-full items-center justify-between gap-4 rounded-2xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[0.9375rem] font-bold text-ink-900">
                    <Zap aria-hidden className="size-4 text-forest-600" />
                    Sólo reserva inmediata
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-ink-500">
                    Queda confirmada al instante, sin esperar nuestra respuesta.
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200",
                    draft.instant ? "bg-forest-700" : "bg-cream-400",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-1 size-5 rounded-full bg-paper shadow-apart-sm transition-transform duration-200",
                      draft.instant ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </span>
              </button>
            </section>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cream-300 bg-paper px-5 py-3 safe-bottom">
          <button
            type="button"
            onClick={clear}
            disabled={!dirty}
            className="h-11 rounded-full px-2 text-[0.9375rem] font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 outline-none hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 disabled:no-underline disabled:opacity-40"
          >
            Limpiar
          </button>
          <ApartButton type="button" variant="primary" size="lg" onClick={apply} aria-live="polite">
            {placesLabel(count)}
          </ApartButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function pick(s: SearchState): FiltersDraft {
  return { bedrooms: s.bedrooms, guests: s.guests, priceMax: s.priceMax, instant: s.instant };
}
