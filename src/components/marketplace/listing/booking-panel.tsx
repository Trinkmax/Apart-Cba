"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Info, Mail } from "lucide-react";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { cn } from "@/lib/utils";
import { useListingStay } from "./stay-context";
import { StayCalendarFooter, StayRangeCalendar, StayStartCalendar } from "./stay-calendar";
import { GuestsStepper } from "./guests-stepper";
import { QuoteBreakdown } from "./quote-breakdown";
import { DateCells, MonthsStepper, PriceHeadline, ViewToggle } from "./booking-panel-parts";

/**
 * Cuerpo del widget de reserva. Lo usan la columna derecha (variant "aside",
 * calendario en Popover) y la hoja de mobile (variant "sheet", calendario a la
 * vista). El estado vive en ListingStayProvider: los dos muestran lo mismo.
 */
export function BookingPanel({ variant = "aside", className }: { variant?: "aside" | "sheet"; className?: string }) {
  const { evaluation, view, listing, settings, consult, dateRequest, months } = useListingStay();
  const [calOpen, setCalOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLButtonElement>(null);

  // "Elegí otras fechas" desde otro lugar de la página (aviso ?error=).
  const [seenRequest, setSeenRequest] = useState(dateRequest.n);
  if (dateRequest.n !== seenRequest) {
    setSeenRequest(dateRequest.n);
    if (variant === "aside" && dateRequest.target === "desktop") setCalOpen(true);
  }

  function openDates() {
    if (variant === "aside") {
      setCalOpen(true);
      return;
    }
    calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    calendarRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])[data-day]")?.focus({ preventScroll: true });
  }

  const hours = settings.responseHours;
  const consultMode = evaluation.kind === "monthly" || evaluation.cta.kind === "consult";
  const micro = consultMode
    ? `Te respondemos en menos de ${hours} h.`
    : listing.instant_book
      ? "Todavía no pagás nada. Queda confirmada al instante."
      : `Todavía no pagás nada. Te confirmamos en menos de ${hours} h.`;

  const calendar =
    view === "mes" ? (
      <StayStartCalendar numberOfMonths={variant === "aside" ? 2 : 1} onPick={() => setCalOpen(false)} />
    ) : (
      <StayRangeCalendar numberOfMonths={variant === "aside" ? 2 : 1} onComplete={() => setCalOpen(false)} />
    );

  return (
    <div className={cn("space-y-5", className)}>
      <PriceHeadline />
      <ViewToggle />

      {variant === "sheet" ? (
        <div ref={calendarRef} className="scroll-mt-4 overflow-hidden rounded-3xl bg-paper ring-1 ring-cream-300">
          <p className="px-4 pt-3 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">
            {view === "mes" ? "Desde cuándo" : "Tus fechas"}
          </p>
          {calendar}
          <StayCalendarFooter />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl bg-paper ring-1 ring-cream-400">
        {variant === "aside" ? (
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="block w-full transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/40"
              >
                <DateCells />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={10}
              className="max-h-[80vh] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-3xl border-cream-300 bg-paper p-0 font-apart shadow-apart-lg"
            >
              {calendar}
              <StayCalendarFooter />
            </PopoverContent>
          </Popover>
        ) : (
          <DateCells />
        )}
        {view === "mes" ? <MonthsStepper className="border-t border-cream-300 px-4 py-3" /> : null}
        <GuestsStepper ref={guestsRef} className="border-t border-cream-300 px-4 py-3" />
      </div>

      <StatusNote />

      <QuoteBreakdown
        evaluation={evaluation}
        currency={listing.marketplace_currency}
        instant={listing.instant_book}
        months={view === "mes" ? months : null}
      />

      <div className="space-y-2.5">
        <PanelCta onDates={openDates} onGuests={() => guestsRef.current?.focus()} />
        {consultMode && consult.whatsappUrl && consult.mailtoUrl ? (
          <p className="text-center text-sm text-ink-500">
            o{" "}
            <a href={consult.mailtoUrl} className="font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700">
              escribinos por mail
            </a>
          </p>
        ) : null}
        <p className="text-center text-[0.8125rem] leading-relaxed text-ink-500">{micro}</p>
      </div>
    </div>
  );
}

/** Estado de la elección en texto claro (fechas que faltan, mínimo de noches, ocupadas…). */
function StatusNote() {
  const { evaluation, blockedStatus } = useListingStay();

  if (evaluation.kind === "invalid") {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-2xl bg-[#fdecea] px-4 py-3 text-sm font-medium leading-snug text-[#b42318]"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {evaluation.message}
      </p>
    );
  }

  let text: string | null = null;
  if (evaluation.kind === "empty") text = evaluation.hint;
  else if (evaluation.kind === "monthly" && evaluation.reason === "long_stay") {
    text = "Las estadías de 28 noches o más se consultan: escribinos y te pasamos el precio por mes.";
  } else if (evaluation.kind === "monthly" && evaluation.hasBlocked) {
    text = "Hay noches ocupadas en ese período. Consultanos y vemos juntos cómo acomodarlo.";
  } else if (evaluation.kind === "monthly" && blockedStatus === "ready" && evaluation.nights == null) {
    text = "Elegí desde cuándo y por cuántos meses para ver un estimado.";
  }
  if (!text) return null;
  return (
    <p className="flex items-start gap-2 text-[0.875rem] leading-snug text-ink-700" aria-live="polite">
      <Info className="mt-0.5 size-4 shrink-0 text-forest-600" aria-hidden />
      {text}
    </p>
  );
}

/** Botón principal del widget según lo elegido (elegir fechas, pedir, reservar o consultar). */
function PanelCta({ onDates, onGuests }: { onDates: () => void; onGuests: () => void }) {
  const { evaluation, consult } = useListingStay();
  const cta = evaluation.cta;
  const full = "w-full";

  switch (cta.kind) {
    case "request":
    case "instant":
      return (
        <ApartButton asChild variant="cta" size="xl" className={full}>
          <Link href={cta.href} prefetch={false}>
            {cta.label}
          </Link>
        </ApartButton>
      );
    case "fix_guests":
      return (
        <ApartButton type="button" variant="cta" size="xl" className={full} onClick={onGuests}>
          {cta.label}
        </ApartButton>
      );
    case "consult":
      if (consult.whatsappUrl) {
        return (
          <ApartButton asChild variant="cta" size="xl" className={full}>
            <a href={consult.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon />
              Consultar por WhatsApp
            </a>
          </ApartButton>
        );
      }
      if (consult.mailtoUrl) {
        return (
          <ApartButton asChild variant="cta" size="xl" className={full}>
            <a href={consult.mailtoUrl}>
              <Mail aria-hidden />
              Consultar por mail
            </a>
          </ApartButton>
        );
      }
      return (
        <ApartButton type="button" variant="cta" size="xl" className={full} disabled>
          Consultar
        </ApartButton>
      );
    case "choose_dates":
    case "change_dates":
    default:
      return (
        <ApartButton type="button" variant="cta" size="xl" className={full} onClick={onDates}>
          {cta.label}
        </ApartButton>
      );
  }
}
