import { Bath, BedDouble, MapPin, Ruler, Users, Zap, type LucideIcon } from "lucide-react";
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

/**
 * Un dato de la fila de celular: ícono en arco, número grande y qué es.
 * ("2 / huéspedes", "1 / dormitorio", "45 / m²").
 */
function StatCell({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1.5 px-1 text-center">
      <span className="flex size-9 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-200 text-forest-700">
        <Icon className="size-[1.05rem]" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-[1.0625rem] font-extrabold tracking-[-0.01em] text-forest-700 tabular-nums">{value}</span>
        <span className="block text-[0.75rem] text-ink-500">{label}</span>
      </span>
    </li>
  );
}

/**
 * Celular (< md): la capacidad en UNA fila de celdas iguales (sin "Hasta", el
 * número grande). Reemplaza a la frase corta y a las pastillas, que dicen lo mismo.
 */
function MobileStats({ listing }: { listing: StorefrontListingDetail }) {
  const guests = Number(listing.max_guests);
  const bedrooms = listing.bedrooms == null ? NaN : Number(listing.bedrooms);
  const baths = Number(listing.bathrooms);
  const size = Number(listing.size_m2);
  const cells: { icon: LucideIcon; value: string; label: string }[] = [];
  if (Number.isFinite(guests) && guests > 0) cells.push({ icon: Users, value: String(guests), label: guests === 1 ? "huésped" : "huéspedes" });
  if (Number.isFinite(bedrooms)) {
    // Monoambiente = un solo ambiente (así se dice en Córdoba).
    cells.push(
      bedrooms <= 0
        ? { icon: BedDouble, value: "1", label: "ambiente" }
        : { icon: BedDouble, value: String(bedrooms), label: bedrooms === 1 ? "dormitorio" : "dormitorios" },
    );
  }
  if (Number.isFinite(baths) && baths > 0) cells.push({ icon: Bath, value: String(baths), label: baths === 1 ? "baño" : "baños" });
  if (listing.size_m2 != null && Number.isFinite(size) && size > 0) cells.push({ icon: Ruler, value: String(size), label: "m²" });
  if (cells.length === 0) return null;
  return (
    <ul
      aria-label="Capacidad"
      className="mt-5 grid auto-cols-fr grid-flow-col divide-x divide-cream-300 rounded-3xl bg-paper py-4 shadow-apart-sm ring-1 ring-cream-300 md:hidden"
    >
      {cells.map((c) => (
        <StatCell key={c.label} icon={c.icon} value={c.value} label={c.label} />
      ))}
    </ul>
  );
}

/**
 * Volver + título de la unidad, su descripción corta, capacidad y compartir/guardar.
 * En celular (< md) es la hoja que sube sobre la foto: volver, compartir y
 * guardar están sobre la galería; el barrio va arriba del título y la
 * capacidad en una fila (MobileStats). Desde md, como siempre.
 */
export function ListingHeader({ listing, pageUrl }: { listing: StorefrontListingDetail; pageUrl: string }) {
  const guests = guestsLabel(listing.max_guests);
  const bedrooms = bedroomsLabel(listing.bedrooms);
  const baths = bathroomsLabel(listing.bathrooms);
  const size = listing.size_m2 != null && Number(listing.size_m2) > 0 ? `${Number(listing.size_m2)} m²` : null;

  return (
    <div>
      <BackLink className="max-md:hidden" />
      <header className="mt-2 flex flex-col gap-5 max-md:mt-0 md:mt-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {listing.hood ? (
            <p className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600 md:hidden">
              <MapPin className="size-3.5 text-coral-500" aria-hidden />
              {listing.hood}
            </p>
          ) : null}
          <h1 className="font-apart text-[2.125rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.625rem] lg:text-[3.125rem]">
            {listing.display_title}
            <BrandDot />
          </h1>
          {listing.display_tagline ? (
            <p className="mt-1.5 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">{listing.display_tagline}</p>
          ) : null}
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-ink-700 max-md:hidden">{listing.summary_line}</p>
          <MobileStats listing={listing} />
          <ul className="mt-4 flex flex-wrap gap-2 max-md:hidden" aria-label="Capacidad">
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
        <ListingShareActions url={pageUrl} title={listing.display_title} unitId={listing.id} className="shrink-0 max-md:hidden" />
      </header>
    </div>
  );
}
