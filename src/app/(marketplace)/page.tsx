import Link from "next/link";
import { Suspense } from "react";
import { CategoryChips } from "@/components/marketplace/category-chips";
import { ListingCard } from "@/components/marketplace/listing-card";
import { HeroSearchBar } from "@/components/marketplace/search-bar";
import {
  getFeaturedListings,
  getPopularCities,
} from "@/lib/actions/marketplace";
import { listWishlistUnitIds } from "@/lib/actions/wishlists";

export default async function MarketplaceHome() {
  return (
    <div>
      <CategoryChips basePath="/buscar" />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-rose-50 via-white to-white">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-12 md:pt-20 pb-16">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-neutral-900 leading-[1.05]">
              Tu próximo lugar te
              <span className="text-rose-500"> está esperando</span>.
            </h1>
            <p className="text-base md:text-lg text-neutral-600 max-w-xl mx-auto">
              Departamentos, casas, lofts y experiencias únicas en toda Argentina. Verificados, listos para mudarte ya.
            </p>
          </div>
          <div className="mt-10 max-w-5xl mx-auto">
            <HeroSearchBar />
          </div>
        </div>
      </section>

      <Suspense fallback={<FeaturedSkeleton />}>
        <FeaturedListings />
      </Suspense>

      <PopularCities />

      <TrustSection />
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] bg-neutral-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    </section>
  );
}

async function FeaturedListings() {
  const [listings, favSet] = await Promise.all([
    getFeaturedListings(8),
    listWishlistUnitIds(),
  ]);

  if (listings.length === 0) {
    return (
      <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-16 text-center">
        <h2 className="text-2xl font-semibold text-neutral-900">¡Estamos preparando algo increíble!</h2>
        <p className="mt-3 text-neutral-600 max-w-md mx-auto">
          Los primeros anfitriones están subiendo sus unidades. Pronto vas a poder reservar acá.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800"
        >
          Soy anfitrión, quiero publicar
        </Link>
      </section>
    );
  }

  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-16">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-neutral-900">Destacados de la semana</h2>
          <p className="text-sm text-neutral-500 mt-1">Lugares que están enamorando a la gente.</p>
        </div>
        <Link
          href="/buscar"
          className="hidden md:inline-flex items-center text-sm font-medium text-neutral-900 hover:underline underline-offset-4"
        >
          Ver todo →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
        {listings.map((listing, i) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            isFavorited={favSet.has(listing.id)}
            priority={i < 4}
          />
        ))}
      </div>
    </section>
  );
}

async function PopularCities() {
  const cities = await getPopularCities();
  if (cities.length === 0) return null;

  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 pb-16">
      <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-6">
        Explorá por destino
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cities.map((c) => (
          <Link
            key={c.city}
            href={`/buscar?ciudad=${encodeURIComponent(c.city)}`}
            className="flex items-center gap-4 p-4 rounded-2xl bg-neutral-50 hover:bg-neutral-100 transition-colors group"
          >
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-rose-100 to-rose-200 flex items-center justify-center text-rose-600 font-bold text-xl">
              {c.city[0]}
            </div>
            <div>
              <div className="font-semibold text-neutral-900">{c.city}</div>
              <div className="text-xs text-neutral-500">
                {c.count} {c.count === 1 ? "alojamiento" : "alojamientos"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TrustSection() {
  const items = [
    {
      title: "Verificados",
      body: "Cada propiedad pasa un proceso de verificación con el anfitrión antes de aparecer.",
      icon: "✓",
    },
    {
      title: "Sin sorpresas",
      body: "El precio que ves es el precio que pagás. Sin cargos ocultos ni comisiones escondidas.",
      icon: "✦",
    },
    {
      title: "Soporte directo",
      body: "Chateás directamente con el anfitrión por WhatsApp. Sin intermediarios.",
      icon: "✉",
    },
  ];
  return (
    <section className="bg-neutral-50 border-y border-neutral-200">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {items.map((it) => (
            <div key={it.title} className="space-y-3">
              <div className="h-12 w-12 rounded-full bg-rose-100 text-rose-600 grid place-items-center text-xl font-bold">
                {it.icon}
              </div>
              <h3 className="text-lg font-semibold text-neutral-900">{it.title}</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
