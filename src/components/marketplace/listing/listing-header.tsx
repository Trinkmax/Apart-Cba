import { Bath, BedDouble, Ruler, Users, Zap, type LucideIcon } from "lucide-react";
import { BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { ListingShareActions } from "@/components/marketplace/listing-share-actions";
import { bathroomsLabel, bedroomsLabel, guestsLabel } from "@/lib/marketplace/display";
import type { StorefrontListingDetail } from "@/lib/marketplace/contracts";
import { BackLink } from "./back-link";

function Chip({ icon: Icon, children, tone = "paper" }: { icon: LucideIcon; children: React.ReactNode; tone?: "paper" | "leaf" }) {
  return (
    <li
      className={
        tone === "leaf"
          ? "inline-flex h-9 items-center gap-1.5 rounded-full bg-leaf-200 px-3.5 text-sm font-semibold text-forest-700"
          : "inline-flex h-9 items-center gap-1.5 rounded-full bg-paper px-3.5 text-sm font-medium text-forest-700 ring-1 ring-cream-300"
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {children}
    </li>
  );
}

/** Volver + título de la unidad, su descripción corta, capacidad y compartir/guardar. */
export function ListingHeader({ listing, pageUrl }: { listing: StorefrontListingDetail; pageUrl: string }) {
  const guests = guestsLabel(listing.max_guests);
  const bedrooms = bedroomsLabel(listing.bedrooms);
  const baths = bathroomsLabel(listing.bathrooms);
  const size = listing.size_m2 != null && Number(listing.size_m2) > 0 ? `${Number(listing.size_m2)} m²` : null;

  return (
    <div>
      <BackLink />
      <header className="mt-2 flex flex-col gap-5 md:mt-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="font-apart text-[2.125rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.625rem] lg:text-[3.125rem]">
            {listing.display_title}
            <BrandDot />
          </h1>
          {listing.display_tagline ? (
            <p className="mt-1.5 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">{listing.display_tagline}</p>
          ) : null}
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-ink-700">{listing.summary_line}</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Capacidad">
            {guests ? <Chip icon={Users}>{guests}</Chip> : null}
            {bedrooms ? <Chip icon={BedDouble}>{bedrooms}</Chip> : null}
            {baths ? <Chip icon={Bath}>{baths}</Chip> : null}
            {size ? <Chip icon={Ruler}>{size}</Chip> : null}
            {listing.instant_book ? (
              <Chip icon={Zap} tone="leaf">
                Reserva inmediata
              </Chip>
            ) : null}
          </ul>
        </div>
        <ListingShareActions url={pageUrl} title={listing.display_title} unitId={listing.id} className="shrink-0" />
      </header>
    </div>
  );
}
