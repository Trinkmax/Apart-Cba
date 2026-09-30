import { Bath, BedDouble, CalendarRange, Clock, Ruler, Sparkles, Users, type LucideIcon } from "lucide-react";
import { bathroomsLabel, bedroomsLabel, checkInWindowLabel, guestsLabel } from "@/lib/marketplace/display";
import { offersShortStays } from "@/lib/marketplace/stay";
import { nightsLabel } from "@/lib/marketplace/widget-quote";
import type { StorefrontListingDetail } from "@/lib/marketplace/contracts";
import { cn } from "@/lib/utils";

function Fact({
  icon: Icon,
  title,
  detail,
  className,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string | null;
  className?: string;
}) {
  return (
    <li className={cn("flex items-start gap-3", className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-200 text-forest-700">
        <Icon className="size-[1.1rem]" aria-hidden />
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-[0.9375rem] font-bold text-forest-700">{title}</span>
        {detail ? <span className="block text-[0.8125rem] leading-snug text-ink-500">{detail}</span> : null}
      </span>
    </li>
  );
}

/**
 * Por debajo de lg la capacidad (huéspedes, dormitorios, baños, m²) ya está en
 * el bloque del título (fila de celular o pastillas de tablet): acá no se repite.
 */
const IN_TITLE_BELOW_LG = "max-lg:hidden";

/** "Lo importante": capacidad, ambientes, check-in, estadía mínima y limpieza. */
export function KeyFacts({ listing }: { listing: StorefrontListingDetail }) {
  const guests = guestsLabel(listing.max_guests);
  const bedrooms = bedroomsLabel(listing.bedrooms);
  const baths = bathroomsLabel(listing.bathrooms);
  const size = listing.size_m2 != null && Number(listing.size_m2) > 0 ? `${Number(listing.size_m2)} m²` : null;
  const checkIn = checkInWindowLabel(listing.check_in_window_start, listing.check_in_window_end);
  const short = offersShortStays(listing);
  const min = Math.max(1, Number(listing.min_nights) || 1);
  const cleaningIncluded = listing.cleaning_fee == null || Number(listing.cleaning_fee) <= 0;

  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
      {guests ? (
        <Fact icon={Users} title={guests} detail="Contando a todas las personas que se quedan." className={IN_TITLE_BELOW_LG} />
      ) : null}
      {bedrooms ? <Fact icon={BedDouble} title={bedrooms} className={IN_TITLE_BELOW_LG} /> : null}
      {baths ? <Fact icon={Bath} title={baths} className={IN_TITLE_BELOW_LG} /> : null}
      {size ? <Fact icon={Ruler} title={size} className={IN_TITLE_BELOW_LG} /> : null}
      {checkIn ? <Fact icon={Clock} title={`Check-in ${checkIn}`} detail="Coordinamos la entrega de llaves con vos." /> : null}
      {short ? (
        <Fact
          icon={CalendarRange}
          title={min > 1 ? `Estadía mínima: ${nightsLabel(min)}` : "Desde 1 noche"}
          detail={listing.offers_monthly ? "También por mes: se consulta." : null}
        />
      ) : (
        <Fact icon={CalendarRange} title="Estadías por mes" detail="Desde 28 noches. Se consultan." />
      )}
      {cleaningIncluded ? <Fact icon={Sparkles} title="Limpieza incluida" detail="No se cobra aparte." /> : null}
    </ul>
  );
}
