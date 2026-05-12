import Link from "next/link";
import { Heart } from "lucide-react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { listWishlistDetails } from "@/lib/actions/wishlists";

export const metadata = {
  title: "Favoritos · rentOS",
};

export default async function FavoritosPage() {
  await requireGuestSession();
  const wishlist = await listWishlistDetails();

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 md:py-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-neutral-900">Favoritos</h1>
          <p className="text-neutral-500 mt-1">
            {wishlist.length === 0
              ? "Aún no guardaste ningún lugar."
              : `${wishlist.length} ${wishlist.length === 1 ? "lugar guardado" : "lugares guardados"}.`}
          </p>
        </div>
      </div>

      {wishlist.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-16 text-center">
          <Heart size={48} className="mx-auto text-neutral-300 mb-4" />
          <h2 className="text-lg font-semibold text-neutral-900">Tu corazón todavía está libre</h2>
          <p className="text-sm text-neutral-600 mt-2 max-w-md mx-auto">
            Tocá el ♡ en cualquier alojamiento para guardarlo y volver más tarde.
          </p>
          <Link
            href="/buscar"
            className="mt-6 inline-flex items-center rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800"
          >
            Explorar lugares
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
          {wishlist.map((l, i) => (
            <ListingCard key={l.id} listing={l} isFavorited priority={i < 4} />
          ))}
        </div>
      )}
    </div>
  );
}
