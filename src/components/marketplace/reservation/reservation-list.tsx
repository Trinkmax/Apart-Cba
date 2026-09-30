import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReservationListItem } from "@/lib/marketplace/contracts";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { StatusPill } from "@/components/marketplace/brand/status-pill";
import { guestsLabel, nightsLabel, stayRangeShort } from "./format";

/** Tarjeta de "Mis reservas": foto en arco, estado, fechas y total. */
export function ReservationListCard({ item }: { item: ReservationListItem }) {
  const waiting = item.stage === "pedido_enviado" || item.stage === "sena_informada";
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-4 rounded-3xl bg-paper p-3 pr-3 shadow-apart-sm ring-1 ring-cream-300 outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-apart-md focus-visible:ring-[3px] focus-visible:ring-forest-500/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:gap-5 sm:p-4"
    >
      <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-b-2xl rounded-t-full bg-cream-200 sm:h-32 sm:w-28">
        {item.cover_url ? (
          <Image src={item.cover_url} alt="" fill sizes="112px" className="object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-forest-700/25">
            <ApartLogo variant="symbol" className="h-8" title={null} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 py-1">
        <StatusPill tone={item.tone} pulse={waiting}>
          {item.pill}
        </StatusPill>
        <p className="mt-2 text-lg font-extrabold leading-tight tracking-[-0.01em] text-forest-700">{item.title}</p>
        {item.hood ? <p className="text-[0.8125rem] text-ink-500">{item.hood}</p> : null}
        <p className="mt-1.5 text-[0.9375rem] font-semibold text-ink-900">{stayRangeShort(item.check_in, item.check_out)}</p>
        <p className="text-[0.8125rem] text-ink-500">
          {nightsLabel(item.nights)} · {guestsLabel(item.guests)} ·{" "}
          <span className="tabular-nums">{formatCurrency(item.total, item.currency || "ARS")}</span>
        </p>
      </div>
      <ChevronRight
        className="size-5 shrink-0 text-ink-400 transition-colors group-hover:text-forest-700"
        aria-hidden
      />
    </Link>
  );
}

export function ReservationList({ items }: { items: ReservationListItem[] }) {
  return (
    <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
      {items.map((item) => (
        <li key={item.key}>
          <ReservationListCard item={item} />
        </li>
      ))}
    </ul>
  );
}
