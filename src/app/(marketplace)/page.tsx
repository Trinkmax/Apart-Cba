import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import type { Viewport } from "next";
import { ArrowRight, BadgeCheck, MessageCircle, Sparkles } from "lucide-react";
import { CategoryChips } from "@/components/marketplace/category-chips";
import { HomeHero } from "@/components/marketplace/home-hero";
import { HomeInspiration } from "@/components/marketplace/home-inspiration";
import { HomeHowItWorks } from "@/components/marketplace/home-how-it-works";
import { HomeHostCta } from "@/components/marketplace/home-host-cta";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Reveal } from "@/components/marketplace/reveal";
import { getFeaturedListings } from "@/lib/actions/marketplace";
import { listWishlistUnitIds } from "@/lib/actions/wishlists";

// Theme-color override solo para el home: la franja Safari arriba/abajo
// matchea el wash oscuro del hero en vez de mostrar bg-blanco del layout.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1a201a" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function MarketplaceHome() {
  return (
    <>
      <CategoryChips basePath="/buscar" />
      <HomeHero />

      <Suspense fallback={<FeaturedSkeleton />}>
        <FeaturedListings />
      </Suspense>

      <CordobaDestinations />

      <HomeInspiration />

      <HomeHowItWorks />

      <TrustSection />

      <HomeHostCta />
    </>
  );
}

/* ─────────────────────────── Skeleton ─────────────────────────── */

function FeaturedSkeleton() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
      <div className="mb-10 md:mb-12 space-y-3">
        <div className="h-3.5 w-24 bg-neutral-100 rounded-full animate-pulse" />
        <div className="h-9 w-72 bg-neutral-100 rounded-md animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[4/3] bg-neutral-100 rounded-2xl animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3 w-2/3 bg-neutral-100 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-neutral-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Featured ─────────────────────────── */

async function FeaturedListings() {
  const [listings, favSet] = await Promise.all([
    getFeaturedListings(8),
    listWishlistUnitIds(),
  ]);

  if (listings.length === 0) {
    return (
      <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-20 md:py-28">
        <Reveal>
          <div className="text-center max-w-md mx-auto">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sage-100 text-sage-700">
              <Sparkles size={20} strokeWidth={1.75} />
            </div>
            <h2 className="mt-6 text-2xl md:text-3xl font-bold text-neutral-900 tracking-[-0.015em]">
              Estamos preparando <span className="italic font-serif">algo lindo</span>
            </h2>
            <p className="mt-3 text-neutral-600 leading-relaxed">
              Los primeros anfitriones están subiendo sus unidades. Volvé en unos días.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-neutral-800 transition-colors"
            >
              Soy anfitrión, quiero publicar
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
          </div>
        </Reveal>
      </section>
    );
  }

  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
      <Reveal className="block mb-10 md:mb-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-700">
              Destacados de la semana
            </span>
            <h2 className="mt-2 text-2xl md:text-4xl font-bold text-neutral-900 tracking-[-0.02em]">
              Lugares que están <span className="italic font-serif font-medium">enamorando</span>
            </h2>
            <p className="hidden md:block text-sm text-neutral-500 mt-2 max-w-md">
              Selección humana, no algoritmo. Lo que más reservaron esta semana.
            </p>
          </div>
          <Link
            href="/buscar"
            className="group hidden md:inline-flex items-center gap-1 text-sm font-medium text-neutral-900 hover:gap-2 transition-all whitespace-nowrap"
          >
            Ver todo
            <ArrowRight
              size={14}
              strokeWidth={2.25}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
        {listings.map((listing, i) => (
          <Reveal key={listing.id} delay={Math.min(i * 60, 360)} y={20}>
            <ListingCard
              listing={listing}
              isFavorited={favSet.has(listing.id)}
              priority={i < 4}
            />
          </Reveal>
        ))}
      </div>
      <div className="mt-8 md:hidden text-center">
        <Link
          href="/buscar"
          className="group inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:border-neutral-900 transition-colors"
        >
          Ver todos los lugares
          <ArrowRight
            size={14}
            strokeWidth={2.5}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </section>
  );
}

/* ───────────────────── Tres caras de Córdoba ───────────────────── */

const CORDOBA_DESTINATIONS = [
  {
    eyebrow: "Centro histórico",
    title: "Donde la historia respira",
    subtitle: "Iglesias jesuíticas, peatonales, cafés con alma. Caminás 200 años en una cuadra.",
    image: "/cordoba/buenpastor.avif",
    href: "/buscar?ciudad=C%C3%B3rdoba&barrio=Centro",
  },
  {
    eyebrow: "Capital cordobesa",
    title: "La ciudad que no duerme",
    subtitle: "Atardeceres rojos sobre Güemes, Nueva Córdoba a las 3am, asados en Cofico.",
    image: "/cordoba/ciudad.webp",
    href: "/buscar?ciudad=C%C3%B3rdoba",
  },
  {
    eyebrow: "Sierras de Córdoba",
    title: "Aire que limpia la cabeza",
    subtitle: "A 40 minutos: ríos transparentes, asados con sonido de chicharras, silencio.",
    image: "/cordoba/sierras.jpg",
    href: "/buscar?ciudad=Sierras",
  },
];

function CordobaDestinations() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
      <Reveal className="block mb-10 md:mb-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-700">
              Destinos
            </span>
            <h2 className="mt-2 text-2xl md:text-4xl font-bold text-neutral-900 tracking-[-0.02em]">
              Tres caras de <span className="italic font-serif font-medium">Córdoba</span>
            </h2>
            <p className="hidden md:block text-sm text-neutral-500 mt-2 max-w-md">
              Elegí tu vibe. Cada barrio cuenta una versión distinta de la ciudad.
            </p>
          </div>
          <Link
            href="/buscar?ciudad=C%C3%B3rdoba"
            className="group hidden md:inline-flex items-center gap-1 text-sm font-medium text-neutral-900 hover:gap-2 transition-all whitespace-nowrap"
          >
            Explorar Córdoba
            <ArrowRight
              size={14}
              strokeWidth={2.25}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        {CORDOBA_DESTINATIONS.map((dest, i) => (
          <Reveal key={dest.title} delay={i * 120} y={28}>
            <Link
              href={dest.href}
              className="group relative block overflow-hidden rounded-3xl bg-neutral-100 aspect-[4/5]
                         transition-shadow duration-500
                         hover:shadow-[0_30px_60px_-20px_rgb(0_0_0/0.35)]"
            >
              <Image
                src={dest.image}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.08]"
                priority={i === 0}
              />
              {/* Bottom-fade scrim + subtle warm top-light for depth */}
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/10 to-transparent"
              />

              <div className="absolute inset-x-0 bottom-0 p-6 md:p-7 text-white">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-white/75 mb-1.5">
                  {dest.eyebrow}
                </div>
                <h3 className="text-xl md:text-2xl font-semibold tracking-[-0.01em] leading-snug">
                  {dest.title}
                </h3>
                <p className="text-sm text-white/80 mt-2 leading-relaxed line-clamp-2 max-w-xs">
                  {dest.subtitle}
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/95
                                transition-all duration-300 group-hover:gap-2.5">
                  Explorar
                  <ArrowRight size={15} strokeWidth={2.25} />
                </div>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Trust pillars ───────────────────────── */

const TRUST_PILLARS = [
  {
    title: "Verificación humana",
    body: "Cada propiedad pasa un proceso real con el anfitrión antes de aparecer. No automatizamos lo importante.",
    icon: BadgeCheck,
  },
  {
    title: "Precio que se siente justo",
    body: "Lo que ves es lo que pagás. Sin cargos ocultos, sin comisiones al final, sin sorpresas.",
    icon: Sparkles,
  },
  {
    title: "Hablás con el anfitrión",
    body: "Chat directo por WhatsApp. Sin intermediarios. Sin tickets. Una persona, una conversación.",
    icon: MessageCircle,
  },
];

function TrustSection() {
  return (
    <section className="bg-white border-t border-neutral-200/80">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-16 md:py-24">
        <Reveal className="block mb-12 md:mb-14 max-w-2xl">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-700">
            Por qué rentOS
          </span>
          <h2 className="mt-2 text-2xl md:text-4xl font-bold text-neutral-900 tracking-[-0.02em]">
            Lo simple, <span className="italic font-serif font-medium">bien hecho</span>.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {TRUST_PILLARS.map((item, i) => {
            const Icon = item.icon;
            return (
              <Reveal key={item.title} delay={i * 140} y={20}>
                <div className="group">
                  <div
                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl
                               bg-sage-100 text-sage-700
                               transition-all duration-300
                               group-hover:bg-sage-600 group-hover:text-white
                               group-hover:-rotate-3"
                  >
                    <Icon size={20} strokeWidth={1.75} />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-neutral-900 tracking-[-0.01em]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-600 leading-relaxed max-w-sm">
                    {item.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
