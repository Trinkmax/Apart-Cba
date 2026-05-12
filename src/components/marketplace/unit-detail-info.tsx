import * as Icons from "lucide-react";
import { Star, Users, Bed, Bath, Maximize2, MapPin, ShieldCheck, CalendarCheck, Zap } from "lucide-react";
import type {
  MarketplaceAmenity,
  MarketplaceListingDetail,
  Review,
} from "@/lib/types/database";

type LucideIcon = (props: { size?: number; className?: string }) => React.JSX.Element;

function getIcon(name: string): LucideIcon {
  const map = Icons as unknown as Record<string, LucideIcon | undefined>;
  return map[name] ?? (Icons.Check as unknown as LucideIcon);
}

type Props = {
  listing: MarketplaceListingDetail;
  amenitiesCatalog: MarketplaceAmenity[];
  reviews: Review[];
};

export function UnitDetailInfo({ listing, amenitiesCatalog, reviews }: Props) {
  const amenitiesByCode = new Map(amenitiesCatalog.map((a) => [a.code, a]));
  const selectedAmenities = listing.amenities
    .map((c) => amenitiesByCode.get(c))
    .filter((a): a is MarketplaceAmenity => Boolean(a));

  return (
    <div className="space-y-10 md:space-y-12">
      {/* Header */}
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold text-neutral-900 leading-tight">
          {listing.marketplace_title}
        </h1>
        <div className="mt-2 text-sm text-neutral-600 flex flex-wrap items-center gap-x-1 gap-y-1">
          {listing.rating_count > 0 ? (
            <>
              <Star size={14} className="fill-neutral-900 stroke-neutral-900" />
              <span className="font-medium text-neutral-900">{listing.rating_avg.toFixed(2)}</span>
              <span>·</span>
              <span className="underline underline-offset-2">
                {listing.rating_count} {listing.rating_count === 1 ? "reseña" : "reseñas"}
              </span>
            </>
          ) : (
            <span className="text-neutral-500">Sin reseñas todavía</span>
          )}
          {(listing.neighborhood || listing.address) ? (
            <>
              <span>·</span>
              <MapPin size={12} />
              <span>{listing.neighborhood ?? listing.address}</span>
            </>
          ) : null}
        </div>
      </header>

      {/* Quick stats */}
      <section className="pb-8 border-b border-neutral-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {capitalize(listing.marketplace_property_type)} en {listing.organization_name}
            </h2>
            <div className="mt-2 flex items-center gap-3 text-sm text-neutral-700 flex-wrap">
              {listing.max_guests ? (
                <span className="inline-flex items-center gap-1.5">
                  <Users size={14} /> {listing.max_guests} huéspedes
                </span>
              ) : null}
              {listing.bedrooms !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Bed size={14} /> {listing.bedrooms} {listing.bedrooms === 1 ? "ambiente" : "ambientes"}
                </span>
              ) : null}
              {listing.bathrooms !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Bath size={14} /> {listing.bathrooms} {listing.bathrooms === 1 ? "baño" : "baños"}
                </span>
              ) : null}
              {listing.size_m2 !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Maximize2 size={14} /> {listing.size_m2} m²
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Highlights */}
        <div className="mt-6 space-y-4">
          {listing.instant_book ? (
            <Highlight
              icon={<Zap size={20} className="text-yellow-500 fill-yellow-500" />}
              title="Reserva al toque"
              body="Confirmación inmediata, sin esperar al anfitrión."
            />
          ) : (
            <Highlight
              icon={<CalendarCheck size={20} className="text-neutral-700" />}
              title="Solicitar y confirmar"
              body="El anfitrión revisa y aprueba tu solicitud en menos de 48 horas."
            />
          )}
          <Highlight
            icon={<ShieldCheck size={20} className="text-emerald-600" />}
            title={`Cancelación ${listing.cancellation_policy}`}
            body={cancelLabel(listing.cancellation_policy)}
          />
        </div>
      </section>

      {/* Description */}
      {listing.marketplace_description ? (
        <section className="pb-8 border-b border-neutral-200">
          <h3 className="text-xl font-semibold text-neutral-900 mb-3">Acerca de este lugar</h3>
          <p className="text-neutral-700 whitespace-pre-wrap leading-relaxed">
            {listing.marketplace_description}
          </p>
        </section>
      ) : null}

      {/* Amenities */}
      {selectedAmenities.length > 0 ? (
        <section className="pb-8 border-b border-neutral-200">
          <h3 className="text-xl font-semibold text-neutral-900 mb-5">Servicios y comodidades</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {selectedAmenities.map((a) => {
              const Icon = getIcon(a.icon);
              return (
                <div key={a.code} className="flex items-center gap-3 py-2">
                  <Icon size={20} className="text-neutral-700 shrink-0" />
                  <span className="text-sm text-neutral-900">{a.name}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* House rules */}
      {listing.house_rules ? (
        <section className="pb-8 border-b border-neutral-200">
          <h3 className="text-xl font-semibold text-neutral-900 mb-3">Reglas de la casa</h3>
          <p className="text-neutral-700 whitespace-pre-wrap leading-relaxed">
            {listing.house_rules}
          </p>
        </section>
      ) : null}

      {/* Reviews */}
      <section className="pb-8 border-b border-neutral-200">
        <div className="flex items-baseline gap-2 mb-5">
          <h3 className="text-xl font-semibold text-neutral-900">
            {listing.rating_count > 0 ? (
              <>
                <Star size={18} className="inline fill-neutral-900 stroke-neutral-900 -mt-0.5" />{" "}
                {listing.rating_avg.toFixed(2)} · {listing.rating_count}{" "}
                {listing.rating_count === 1 ? "reseña" : "reseñas"}
              </>
            ) : (
              "Aún no hay reseñas"
            )}
          </h3>
        </div>
        {reviews.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Sé el primero en compartir tu experiencia en este lugar.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {reviews.slice(0, 6).map((r) => (
              <article key={r.id}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-10 w-10 rounded-full bg-sage-100 grid place-items-center text-sage-700 font-semibold text-sm">
                    {r.guest_name_snapshot[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{r.guest_name_snapshot}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(r.created_at).toLocaleDateString("es-AR", {
                        year: "numeric",
                        month: "long",
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 mb-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={12}
                      className={i < r.rating ? "fill-neutral-900 stroke-neutral-900" : "stroke-neutral-300"}
                    />
                  ))}
                </div>
                <p className="text-sm text-neutral-700 leading-relaxed line-clamp-6">
                  {r.comment ?? "Sin comentario"}
                </p>
                {r.host_response ? (
                  <div className="mt-3 pl-4 border-l-2 border-neutral-200">
                    <div className="text-xs font-medium text-neutral-900 mb-1">
                      Respuesta del anfitrión
                    </div>
                    <p className="text-xs text-neutral-600 line-clamp-4">{r.host_response}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Highlight({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="font-medium text-neutral-900">{title}</div>
        <div className="text-sm text-neutral-600">{body}</div>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function cancelLabel(p: MarketplaceListingDetail["cancellation_policy"]) {
  switch (p) {
    case "flexible":
      return "Cancelá gratis hasta 24 hs antes del check-in.";
    case "moderada":
      return "Cancelación gratuita hasta 5 días antes. Después se cobra el 50%.";
    case "estricta":
      return "Cancelación con cargo total. Asegurate de tus fechas.";
    default:
      return "";
  }
}
