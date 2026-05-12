import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  getListing,
  listMarketplaceAmenitiesCatalog,
} from "@/lib/actions/listings";
import { ListingManagerClient } from "@/components/units/listing-manager-client";

export const metadata = {
  title: "Listing marketplace · rentOS",
};

type Params = Promise<{ id: string }>;

export default async function UnitMarketplacePage({ params }: { params: Params }) {
  const { id } = await params;
  const [data, amenitiesCatalog] = await Promise.all([
    getListing(id),
    listMarketplaceAmenitiesCatalog(),
  ]);
  if (!data.unit) notFound();

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">
      <Link
        href={`/dashboard/unidades/${id}`}
        className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
      >
        <ChevronLeft size={14} />
        Volver a {data.unit.code}
      </Link>
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold text-neutral-900">
          Listing en rentOS
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Publicá esta unidad en el marketplace público. Cuando esté lista, prendé el switch para
          que los huéspedes la vean.
        </p>
      </div>
      <ListingManagerClient
        unit={data.unit}
        photos={data.photos}
        amenityCodes={data.amenityCodes}
        rules={data.rules}
        amenitiesCatalog={amenitiesCatalog}
        mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
      />
    </div>
  );
}
