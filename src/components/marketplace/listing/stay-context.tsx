"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getUnitBlockedDates } from "@/lib/actions/storefront";
import { whatsappLink } from "@/lib/marketplace/display";
import { countNights, todayIsoAR } from "@/lib/marketplace/pricing";
import type { DepositPolicy } from "@/lib/marketplace/sena";
import {
  addMonthsIso,
  clampInt,
  consultMailto,
  consultMessage,
  consultSubject,
  evaluateStay,
  listingErrorMessage,
  maxGuestsFor,
  MAX_CONSULT_MONTHS,
  monthsFromNights,
  parseStayParams,
  viewOptions,
  type StayEvaluation,
  type StayView,
  type WidgetListing,
} from "@/lib/marketplace/widget-quote";

/** Lo mínimo de la unidad que viaja al cliente (no toda la ficha). */
export interface StayListing extends WidgetListing {
  slug: string;
  hood: string | null;
}

export interface StaySettings {
  responseHours: number;
  deposit: Pick<DepositPolicy, "rule" | "percent">;
  whatsappNumber: string | null;
  publicEmail: string | null;
}

type BlockedStatus = "loading" | "ready" | "error";

export interface ListingStayValue {
  listing: StayListing;
  settings: StaySettings;
  views: StayView[];
  view: StayView;
  setView: (v: StayView) => void;
  today: string;
  /** Último día que se puede elegir (ventana de ocupación conocida). */
  maxIso: string;
  checkIn: string;
  checkOut: string;
  months: number;
  guests: number;
  maxGuests: number;
  setRange: (checkIn: string, checkOut: string) => void;
  setMonthStart: (checkIn: string) => void;
  setMonths: (n: number) => void;
  setGuests: (n: number) => void;
  clearDates: () => void;
  blocked: ReadonlySet<string>;
  blockedStatus: BlockedStatus;
  evaluation: StayEvaluation;
  consult: { message: string; whatsappUrl: string | null; mailtoUrl: string | null };
  /** Aviso que trajo el checkout por `?error=` (ya traducido). */
  urlError: string | null;
  dismissUrlError: () => void;
  /** Pedido de "abrí el selector de fechas" (lo atiende el widget visible). */
  dateRequest: { n: number; target: "desktop" | "mobile" };
  requestDates: () => void;
}

const StayContext = createContext<ListingStayValue | null>(null);

export function useListingStay(): ListingStayValue {
  const ctx = useContext(StayContext);
  if (!ctx) throw new Error("useListingStay fuera de ListingStayProvider");
  return ctx;
}

const EMPTY_BLOCKED: ReadonlySet<string> = new Set();
const noopSubscribe = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => null;

export function ListingStayProvider({
  listing,
  settings,
  pageUrl,
  children,
}: {
  listing: StayListing;
  settings: StaySettings;
  /** URL absoluta de la ficha (va en el mensaje de consulta). */
  pageUrl: string;
  children: React.ReactNode;
}) {
  const [today] = useState(() => todayIsoAR());
  const [maxIso, setMaxIso] = useState(() => addMonthsIso(today, 12));
  const views = useMemo(() => viewOptions(listing), [listing]);
  const [sel, setSel] = useState(() => parseStayParams(null, listing, today));
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(EMPTY_BLOCKED);
  const [blockedStatus, setBlockedStatus] = useState<BlockedStatus>("loading");
  const [dateRequest, setDateRequest] = useState<{ n: number; target: "desktop" | "mobile" }>({ n: 0, target: "desktop" });

  // `?checkin&checkout&huespedes&error` se leen en el cliente: la página es
  // estática (ISR) y no puede mirar searchParams en el server (y
  // useSearchParams haría que toda la ficha se renderice sólo en el cliente).
  // Se aplican cuando cambia la query observada: al hidratar (el snapshot del
  // server es null) y, en una navegación del lado del cliente, cuando el
  // router termina de actualizar la URL (en el primer render todavía puede
  // verse la query de la página anterior; useSyncExternalStore vuelve a leer
  // después del commit y re-renderiza si cambió).
  const search = useSyncExternalStore(noopSubscribe, readSearch, serverSearch);
  const [appliedSearch, setAppliedSearch] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  if (search !== null && search !== appliedSearch) {
    setAppliedSearch(search);
    setSel(parseStayParams(search, listing, today));
    setUrlError(listingErrorMessage(new URLSearchParams(search).get("error")));
  }

  useEffect(() => {
    let alive = true;
    getUnitBlockedDates(listing.id)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setBlocked(new Set(res.blocked));
          if (res.to) setMaxIso(res.to);
          setBlockedStatus("ready");
        } else {
          setBlockedStatus("error");
        }
      })
      .catch(() => {
        if (alive) setBlockedStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [listing.id]);

  const maxGuests = maxGuestsFor(listing);
  const evaluation = useMemo(
    () =>
      evaluateStay({
        listing,
        view: sel.view,
        checkIn: sel.checkIn,
        checkOut: sel.checkOut,
        guests: sel.guests,
        blocked,
        today,
        policy: settings.deposit,
      }),
    [listing, sel, blocked, today, settings.deposit],
  );

  function setView(v: StayView) {
    if (!views.includes(v)) return;
    setSel((s) => {
      if (s.view === v) return s;
      if (v === "mes") {
        const nights = s.checkIn && s.checkOut ? countNights(s.checkIn, s.checkOut) : 0;
        const months = nights >= 28 ? monthsFromNights(nights) : s.months;
        return { ...s, view: v, months, checkOut: s.checkIn ? addMonthsIso(s.checkIn, months) : "" };
      }
      // De mes a noches: se conserva la llegada y se vuelve a elegir la salida.
      return { ...s, view: v, checkOut: "" };
    });
  }

  function setRange(checkIn: string, checkOut: string) {
    setSel((s) => ({ ...s, checkIn, checkOut }));
  }

  function setMonthStart(checkIn: string) {
    setSel((s) => ({ ...s, checkIn, checkOut: checkIn ? addMonthsIso(checkIn, s.months) : "" }));
  }

  function setMonths(n: number) {
    const months = clampInt(n, 1, MAX_CONSULT_MONTHS);
    setSel((s) => ({ ...s, months, checkOut: s.view === "mes" && s.checkIn ? addMonthsIso(s.checkIn, months) : s.checkOut }));
  }

  function setGuests(n: number) {
    setSel((s) => ({ ...s, guests: clampInt(n, 1, maxGuests) }));
  }

  function clearDates() {
    setSel((s) => ({ ...s, checkIn: "", checkOut: "" }));
  }

  function requestDates() {
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    setDateRequest((r) => ({ n: r.n + 1, target: desktop ? "desktop" : "mobile" }));
  }

  // Consulta por WhatsApp / mail: con las fechas y huéspedes elegidos.
  const consultView: StayView = evaluation.kind === "monthly" ? "mes" : "noche";
  const consultNights = sel.checkIn && sel.checkOut && sel.checkOut > sel.checkIn ? countNights(sel.checkIn, sel.checkOut) : 0;
  const message = consultMessage({
    title: listing.display_title,
    hood: listing.hood,
    view: consultView,
    checkIn: sel.checkIn || null,
    checkOut: sel.checkOut || null,
    months: consultView === "mes" && sel.checkIn ? (sel.view === "mes" ? sel.months : monthsFromNights(consultNights)) : null,
    guests: sel.guests,
    url: pageUrl,
  });
  const consult = {
    message,
    whatsappUrl: whatsappLink(settings.whatsappNumber, message),
    mailtoUrl: consultMailto(settings.publicEmail, consultSubject({ title: listing.display_title, view: consultView }), message),
  };

  const value: ListingStayValue = {
    listing,
    settings,
    views,
    view: sel.view,
    setView,
    today,
    maxIso,
    checkIn: sel.checkIn,
    checkOut: sel.checkOut,
    months: sel.months,
    guests: sel.guests,
    maxGuests,
    setRange,
    setMonthStart,
    setMonths,
    setGuests,
    clearDates,
    blocked,
    blockedStatus,
    evaluation,
    consult,
    urlError,
    dismissUrlError: () => setUrlError(null),
    dateRequest,
    requestDates,
  };

  return <StayContext.Provider value={value}>{children}</StayContext.Provider>;
}
