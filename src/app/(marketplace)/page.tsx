import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { CategoryChips } from "@/components/marketplace/category-chips";
import { ListingCard } from "@/components/marketplace/listing-card";
import { HeroSearchBar } from "@/components/marketplace/search-bar";
import { getFeaturedListings } from "@/lib/actions/marketplace";
import { listWishlistUnitIds } from "@/lib/actions/wishlists";

export default async function MarketplaceHome() {
  return (
    <>
      <CategoryChips basePath="/buscar" />

      {/* Hero full-bleed con foto de Córdoba. Negative margin-top pulls the hero
          BEHIND the sticky header + chips for a seamless image-to-edge effect. */}
      <section className="relative overflow-hidden flex items-center -mt-[148px] pt-[180px] pb-16 md:pb-24 min-h-[680px] md:min-h-[760px]">
        <Image
          src="/cordoba/ciudad.webp"
          alt="Córdoba al atardecer"
          fill
          priority
          sizes="100vw"
          className="object-cover -z-10"
        />
        {/* Overlay sage + degrade para contraste de texto y blend con header */}
        <div className="absolute inset-0 bg-gradient-to-b from-sage-900/55 via-sage-900/35 to-sage-900/60 -z-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent -z-10" />

        <div className="relative w-full max-w-[1400px] mx-auto px-4 md:px-8">
          <div className="max-w-3xl mx-auto text-center space-y-5 text-white">
            <span className="inline-block text-[11px] font-semibold uppercase tracking-[0.18em] text-sage-100/90">
              Córdoba · Argentina
            </span>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] drop-shadow-md">
              Quedate donde
              <br className="hidden md:block" />
              <span className="italic font-serif"> la ciudad late</span>.
            </h1>
            <p className="text-base md:text-lg text-white/85 max-w-xl mx-auto leading-relaxed">
              Departamentos curados en barrios reales. Reservás directo con el anfitrión, sin
              comisiones escondidas.
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

      <CordobaDestinations />

      <TrustSection />
    </>
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

const CORDOBA_DESTINATIONS = [
  {
    title: "Centro histórico",
    subtitle: "Iglesias jesuíticas, peatonales, cafés con alma",
    image: "/cordoba/buenpastor.avif",
    href: "/buscar?ciudad=Córdoba&barrio=Centro",
  },
  {
    title: "Capital cordobesa",
    subtitle: "Atardeceres rojos y vida nocturna en Güemes",
    image: "/cordoba/ciudad.webp",
    href: "/buscar?ciudad=Córdoba",
  },
  {
    title: "Sierras de Córdoba",
    subtitle: "Aire serrano a 40 min: ríos, asados, silencio",
    image: "/cordoba/sierras.jpg",
    href: "/buscar?ciudad=Sierras",
  },
];

function CordobaDestinations() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-neutral-900">
            Tres caras de Córdoba
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Elegí tu vibe: ciudad, historia o sierras.
          </p>
        </div>
        <Link
          href="/buscar?ciudad=Córdoba"
          className="hidden md:inline-flex items-center text-sm font-medium text-neutral-900 hover:underline underline-offset-4"
        >
          Ver todo →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        {CORDOBA_DESTINATIONS.map((dest, i) => (
          <Link
            key={dest.title}
            href={dest.href}
            className="group relative overflow-hidden rounded-2xl bg-neutral-100 aspect-[4/5] md:aspect-[4/5]"
          >
            <Image
              src={dest.image}
              alt={dest.title}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
              priority={i === 0}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 md:p-6 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-sage-100/90 mb-1.5">
                Destino · Córdoba
              </div>
              <h3 className="text-xl md:text-2xl font-semibold tracking-tight">
                {dest.title}
              </h3>
              <p className="text-sm text-white/85 mt-1 line-clamp-2">{dest.subtitle}</p>
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium opacity-90 group-hover:opacity-100 group-hover:gap-2 transition-all">
                Explorar
                <span aria-hidden>→</span>
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
              <div className="h-12 w-12 rounded-full bg-sage-100 text-sage-600 grid place-items-center text-xl font-bold">
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
