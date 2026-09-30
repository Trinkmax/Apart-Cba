"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { List } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ListingsMapProps } from "@/components/marketplace/listings-map";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import {
  cardPrice,
  listingHref,
  nightsLabel,
  type SearchMode,
  type StayInput,
} from "@/lib/marketplace/catalog-filter";
import { bedroomsLabel, guestsLabel } from "@/lib/marketplace/display";
import { formatCurrency } from "@/lib/marketplace/pricing";
import type { HoverStore } from "./hover-store";

/**
 * Mobile: el mapa a pantalla completa con las tarjetas deslizables abajo.
 * Tocar una píldora lleva el carrusel a esa tarjeta; deslizar el carrusel
 * pinta la píldora de la tarjeta del centro. El mapa se monta sólo abierto.
 */
export function MobileMapSheet({
  open,
  onOpenChange,
  listings,
  view,
  stay,
  hoverStore,
  title,
  MapComponent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listings: CatalogListing[];
  view: SearchMode;
  stay?: StayInput;
  hoverStore: HoverStore;
  title: string;
  /** El mapa (lazy): se monta sólo con la hoja abierta. */
  MapComponent: React.ComponentType<ListingsMapProps>;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const rafRef = useRef<number | null>(null);

  function scrollToCard(id: string) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
    hoverStore.set(id);
  }

  function onScroll() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const list = listRef.current;
      if (!list) return;
      const center = list.scrollLeft + list.clientWidth / 2;
      let best: { id: string; d: number } | null = null;
      for (const child of Array.from(list.children) as HTMLElement[]) {
        const d = Math.abs(child.offsetLeft + child.offsetWidth / 2 - center);
        const id = child.dataset.cardId;
        if (id && (!best || d < best.d)) best = { id, d };
      }
      if (best) hoverStore.set(best.id);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) hoverStore.set(null);
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="h-[100dvh] gap-0 border-0 bg-cream p-0 font-apart"
      >
        <SheetTitle className="sr-only">Mapa: {title}</SheetTitle>
        <SheetDescription className="sr-only">
          Tocá un precio para ver ese lugar. Deslizá las tarjetas de abajo para recorrerlos.
        </SheetDescription>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            {open ? (
              <MapComponent
                listings={listings}
                view={view}
                stay={stay}
                hoverStore={hoverStore}
                popups={false}
                onSelect={scrollToCard}
              />
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 pt-3 safe-top">
            <p className="pointer-events-auto truncate rounded-full bg-paper/95 px-4 py-2 text-[0.875rem] font-bold text-forest-700 shadow-apart-sm">
              {title}
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="pointer-events-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-forest-700 px-4 text-[0.9375rem] font-bold text-cream shadow-apart-md outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/50"
            >
              <List aria-hidden className="size-[1.1rem]" />
              Ver lista
            </button>
          </div>

          <ul
            ref={listRef}
            onScroll={onScroll}
            aria-label="Lugares en el mapa"
            className="no-scrollbar absolute inset-x-0 bottom-0 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 safe-bottom"
          >
            {listings.map((l) => (
              <li key={l.id} data-card-id={l.id} className="w-[86%] max-w-sm shrink-0 snap-center">
                <MapCard listing={l} view={view} stay={stay} />
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Tarjeta horizontal compacta del carrusel del mapa. */
function MapCard({ listing, view, stay }: { listing: CatalogListing; view: SearchMode; stay?: StayInput }) {
  const price = cardPrice(listing, view, stay);
  const cover = listing.photo_urls[0] ?? listing.cover_url;
  const capacity = [bedroomsLabel(listing.bedrooms), guestsLabel(listing.max_guests)].filter(Boolean).join(" · ");
  return (
    <Link
      href={listingHref(listing.slug, stay)}
      className="flex items-stretch gap-3 rounded-3xl bg-paper p-2 shadow-apart-lg ring-1 ring-cream-300 outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
    >
      <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl bg-cream-200">
        {cover ? <Image src={cover} alt="" fill sizes="112px" className="object-cover" /> : null}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-0.5 py-1 pr-2">
        {listing.hood ? <p className="truncate text-[0.75rem] text-ink-500">{listing.hood}</p> : null}
        <p className="truncate text-[0.9375rem] font-bold text-forest-700">{listing.display_title}</p>
        {capacity ? <p className="truncate text-[0.8125rem] text-ink-600">{capacity}</p> : null}
        <p className="pt-1 text-[0.875rem] tabular-nums text-ink-900">
          {price.kind === "total" ? (
            <>
              <span className="font-bold">{formatCurrency(price.total, price.currency)}</span> total ·{" "}
              {nightsLabel(price.nights)}
            </>
          ) : price.kind === "amount" ? (
            <>
              <span className="font-bold">{formatCurrency(price.amount, price.currency)}</span>{" "}
              {price.per === "mes" ? "mes" : "noche"}
            </>
          ) : (
            <span className="font-semibold text-forest-700">Precio a consultar</span>
          )}
        </p>
      </div>
    </Link>
  );
}
