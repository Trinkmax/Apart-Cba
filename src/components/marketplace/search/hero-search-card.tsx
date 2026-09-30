"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { EMPTY_SEARCH, searchHref } from "@/lib/marketplace/catalog-filter";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import { DatesField, GuestsField, MonthStartField, MonthsCountField } from "./search-fields";
import { EMPTY_DRAFT, draftToState, useSearchDraft } from "./use-search-draft";

type OpenField = "dates" | "guests" | "start" | "months" | null;

/**
 * Buscador del hero ("¿Cuándo venís?"). Por noches: Llegada · Salida ·
 * Huéspedes; por meses: Desde · Cuántos meses · Huéspedes. "Buscar" lleva a
 * /buscar con los parámetros de SPEC 20 (nada es obligatorio: sin fechas se
 * ve todo el catálogo).
 */
export function HeroSearchCard({
  responseHours,
  className,
}: {
  responseHours?: number;
  className?: string;
}) {
  const router = useRouter();
  const { draft, setMode, setDates, setStart, setMonths, setGuests } = useSearchDraft(EMPTY_DRAFT);
  const [openField, setOpenField] = useState<OpenField>(null);
  const [pending, startTransition] = useTransition();

  const opener = (field: Exclude<OpenField, null>) => (open: boolean) =>
    setOpenField((current) => (open ? field : current === field ? null : current));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOpenField(null);
    const href = searchHref(draftToState(draft, EMPTY_SEARCH));
    startTransition(() => router.push(href));
  }

  const hours = responseHours && responseHours > 0 ? Math.round(responseHours) : null;
  const footnote =
    draft.mode === "mes"
      ? "Las estadías por mes se consultan: te pasamos el precio final y las condiciones."
      : hours
        ? `Todavía no pagás nada. Te confirmamos en menos de ${hours} h.`
        : "Todavía no pagás nada al pedir tus fechas.";

  const groupClass =
    "grid gap-1 rounded-2xl bg-cream-50 p-1 ring-1 ring-inset ring-cream-300";

  return (
    <form
      role="search"
      aria-label="Buscar alojamiento"
      onSubmit={submit}
      className={cn(
        "w-full rounded-3xl bg-paper p-4 font-apart shadow-apart-lg ring-1 ring-cream-300 sm:p-5",
        className,
      )}
    >
      {/* Teléfono (< sm): la pregunta queda para lectores de pantalla (arriba ya está el
          titular del hero) y "Por noches | Por meses" ocupa todo el ancho. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 max-sm:mb-2.5">
        <h2 className="text-lg font-extrabold tracking-[-0.02em] text-forest-700 max-sm:sr-only sm:text-xl">
          ¿Cuándo venís?
        </h2>
        <ModeToggle
          size="sm"
          className="max-sm:grid max-sm:w-full max-sm:grid-cols-2"
          value={draft.mode}
          onChange={(mode) => {
            setOpenField(null);
            setMode(mode);
          }}
        />
      </div>

      {draft.mode === "noche" ? (
        <div className={cn(groupClass, "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
          <DatesField
            checkIn={draft.checkIn}
            checkOut={draft.checkOut}
            onChange={setDates}
            open={openField === "dates"}
            onOpenChange={opener("dates")}
            onComplete={() => setOpenField("guests")}
            className="gap-1"
          />
          <GuestsField
            value={draft.guests}
            onChange={setGuests}
            open={openField === "guests"}
            onOpenChange={opener("guests")}
          />
        </div>
      ) : (
        <div className={cn(groupClass, "grid-cols-2 sm:grid-cols-3")}>
          <MonthStartField
            value={draft.checkIn}
            onChange={setStart}
            open={openField === "start"}
            onOpenChange={opener("start")}
            onComplete={() => setOpenField("months")}
          />
          <MonthsCountField
            value={draft.months}
            onChange={setMonths}
            open={openField === "months"}
            onOpenChange={opener("months")}
          />
          <div className="col-span-2 sm:col-span-1">
            <GuestsField
              value={draft.guests}
              onChange={setGuests}
              open={openField === "guests"}
              onOpenChange={opener("guests")}
            />
          </div>
        </div>
      )}

      <ApartButton
        type="submit"
        variant="cta"
        size="xl"
        disabled={pending}
        aria-busy={pending || undefined}
        className="mt-3 w-full"
      >
        {pending ? (
          <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" />
        ) : (
          <Search aria-hidden className="size-5" strokeWidth={2.5} />
        )}
        {pending ? "Buscando…" : "Buscar"}
      </ApartButton>

      <p className="mt-3 text-center text-[0.8125rem] leading-snug text-ink-600">{footnote}</p>
    </form>
  );
}
