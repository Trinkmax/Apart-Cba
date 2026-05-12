import { CategoryChips } from "@/components/marketplace/category-chips";
import { SearchFiltersBar } from "@/components/marketplace/search-filters-bar";
import { SearchResultsClient } from "@/components/marketplace/search-results-client";
import { searchListings, type SearchFilters } from "@/lib/actions/marketplace";
import { listWishlistUnitIds } from "@/lib/actions/wishlists";

export const metadata = {
  title: "Buscar alojamientos · rentOS",
};

type SearchParamsPromise = Promise<Record<string, string | string[] | undefined>>;

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const sp = await searchParams;

  const getStr = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : null;
  };
  const getInt = (k: string) => {
    const s = getStr(k);
    if (!s) return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };

  const filters: SearchFilters = {
    city: getStr("ciudad"),
    neighborhood: getStr("barrio"),
    checkIn: getStr("checkin"),
    checkOut: getStr("checkout"),
    guests: getInt("huespedes"),
    bedroomsMin: getInt("ambientes"),
    priceMin: getInt("precio_min"),
    priceMax: getInt("precio_max"),
    propertyTypes: getStr("tipo") ? [getStr("tipo") as string] : null,
    instantBookOnly: getStr("instant") === "1",
    sort: (getStr("orden") as SearchFilters["sort"]) ?? "recommended",
    limit: 40,
  };

  const [{ listings, total }, favIds] = await Promise.all([
    searchListings(filters),
    listWishlistUnitIds(),
  ]);

  // Construir lista de filtros activos para mostrar pills
  const activeFilters = [
    filters.city ? { key: "ciudad", label: `Ciudad: ${filters.city}` } : null,
    filters.checkIn && filters.checkOut
      ? { key: "checkin", label: `${filters.checkIn} → ${filters.checkOut}` }
      : null,
    filters.guests ? { key: "huespedes", label: `${filters.guests}+ huéspedes` } : null,
    filters.bedroomsMin ? { key: "ambientes", label: `${filters.bedroomsMin}+ ambientes` } : null,
    filters.priceMin ? { key: "precio_min", label: `Desde $${filters.priceMin}` } : null,
    filters.priceMax ? { key: "precio_max", label: `Hasta $${filters.priceMax}` } : null,
    filters.propertyTypes?.[0]
      ? { key: "tipo", label: capitalize(filters.propertyTypes[0]) }
      : null,
    filters.instantBookOnly ? { key: "instant", label: "Reserva al toque" } : null,
  ].filter((f): f is { key: string; label: string } => f !== null);

  return (
    <div>
      <CategoryChips basePath="/buscar" />
      <SearchFiltersBar totalResults={total} activeFilters={activeFilters} />
      <SearchResultsClient listings={listings} favoritedIds={Array.from(favIds)} />
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
