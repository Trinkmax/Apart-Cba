import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReservationListItem } from "@/lib/marketplace/contracts";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { StatusPill } from "@/components/marketplace/brand/status-pill";
import { cn } from "@/lib/utils";
import { guestsLabel, nightsLabel, stayRangeShort } from "./format";

/**
 * Tarjeta de "Mis reservas": foto en arco, estado, fechas y total. En celular y
 * tablet es vertical: la foto arriba a lo ancho con el estado encima.
 */
export function ReservationListCard({ item }: { item: ReservationListItem }) {
  const waiting = item.stage === "pedido_enviado" || item.stage === "sena_informada";
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center rounded-3xl bg-paper shadow-apart-sm ring-1 ring-cream-300 outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-apart-md focus-visible:ring-[3px] focus-visible:ring-forest-500/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:gap-5 lg:p-4",
        // Celular y tablet: tarjeta vertical, la foto arriba a lo ancho.
        // overflow-clip (no hidden): hidden convierte la tarjeta en "scroller" y el
        // zoom de la foto (view()) queda congelado.
        "max-lg:relative max-lg:h-full max-lg:flex-col max-lg:items-stretch max-lg:overflow-clip",
      )}
    >
      <div className="relative shrink-0 overflow-hidden bg-cream-200 max-lg:aspect-[16/10] max-lg:w-full max-lg:overflow-clip lg:h-32 lg:w-28 lg:rounded-b-2xl lg:rounded-t-full">
        {item.cover_url ? (
          <Image
            src={item.cover_url}
            alt=""
            fill
            sizes="(max-width: 639px) 92vw, (max-width: 1023px) 46vw, 112px"
            className="m-zoom-in object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-forest-700/25">
            <ApartLogo variant="symbol" className="h-8" title={null} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 py-1 max-lg:pb-4 max-lg:pl-4 max-lg:pr-14 max-lg:pt-3.5">
        {/* Celular: la pastilla del estado va sobre la foto. */}
        <StatusPill
          tone={item.tone}
          pulse={waiting}
          className="max-lg:absolute max-lg:left-3 max-lg:top-3 max-lg:z-10 max-lg:shadow-apart-sm"
        >
          {item.pill}
        </StatusPill>
        <p className="mt-2 text-lg font-extrabold leading-tight tracking-[-0.01em] text-forest-700 max-lg:mt-0">{item.title}</p>
        {item.hood ? <p className="text-[0.8125rem] text-ink-500">{item.hood}</p> : null}
        <p className="mt-1.5 text-[0.9375rem] font-semibold text-ink-900">{stayRangeShort(item.check_in, item.check_out)}</p>
        <p className="text-[0.8125rem] text-ink-500">
          {nightsLabel(item.nights)} · {guestsLabel(item.guests)} ·{" "}
          <span className="tabular-nums">{formatCurrency(item.total, item.currency || "ARS")}</span>
        </p>
      </div>
      <ChevronRight
        className="size-5 shrink-0 text-ink-400 transition-colors group-hover:text-forest-700 max-lg:absolute max-lg:bottom-4 max-lg:right-4 max-lg:size-9 max-lg:rounded-full max-lg:bg-leaf-100 max-lg:p-2 max-lg:text-forest-700"
        aria-hidden
      />
    </Link>
  );
}

export function ReservationList({ items }: { items: ReservationListItem[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      {items.map((item) => (
        <li key={item.key} className="m-rise">
          <ReservationListCard item={item} />
        </li>
      ))}
    </ul>
  );
}
