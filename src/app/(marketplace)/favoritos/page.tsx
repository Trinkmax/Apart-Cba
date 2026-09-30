import Link from "next/link";
import type { Metadata } from "next";
import { Heart, Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ArchShape, BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { FavoritesGrid } from "@/components/marketplace/wishlist/favorites-grid";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { getMyWishlistIds } from "@/lib/actions/storefront";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import { getStorefrontCatalog } from "@/lib/marketplace/storefront";

export const metadata: Metadata = {
  title: "Favoritos",
  robots: { index: false, follow: false },
};

export default async function FavoritosPage() {
  await requireGuestSession("/favoritos");
  const [catalog, ids] = await Promise.all([getStorefrontCatalog(), getMyWishlistIds()]);

  // Sólo lo que sigue en la vidriera, en el orden del catálogo.
  const saved = new Set(ids);
  const listings: CatalogListing[] = catalog.listings.filter((l) => saved.has(l.id));
  const n = listings.length;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-10 font-apart sm:px-6 lg:px-8 lg:pt-14">
      <header className="mb-8">
        <Eyebrow>Tu lista</Eyebrow>
        <h1 className="mt-2 text-[2rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 sm:text-[2.5rem]">
          Favoritos
          <BrandDot />
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-600">
          {n === 0
            ? "Los lugares que guardes van a aparecer acá."
            : `${n} ${n === 1 ? "lugar guardado" : "lugares guardados"} para volver a mirar cuando quieras.`}
        </p>
      </header>

      {n === 0 ? (
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl bg-paper px-6 py-12 text-center shadow-apart-sm ring-1 ring-cream-300">
          <ArchShape className="grid h-24 w-20 place-items-center bg-leaf-200">
            <Heart aria-hidden className="mt-3 size-7 text-coral-500" strokeWidth={2.25} />
          </ArchShape>
          <h2 className="mt-6 text-xl font-extrabold tracking-[-0.02em] text-forest-700">
            Todavía no guardaste lugares.
          </h2>
          <p className="mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-ink-600">
            Tocá el corazón de cualquier departamento para guardarlo y compararlo después.
          </p>
          <ApartButton asChild variant="cta" size="lg" className="mt-6">
            <Link href="/buscar">
              <Search aria-hidden className="size-5" strokeWidth={2.5} />
              Buscar alojamiento
            </Link>
          </ApartButton>
        </div>
      ) : (
        <FavoritesGrid listings={listings} />
      )}
    </div>
  );
}
