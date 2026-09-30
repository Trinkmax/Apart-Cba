import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchResultsClient } from "@/components/marketplace/search-results-client";
import { SearchResultsFallback } from "@/components/marketplace/search/search-results-fallback";
import { getStorefrontCatalog } from "@/lib/marketplace/storefront";
import { getSiteContact } from "@/lib/marketplace/web-settings-server";

// ISR: el catálogo entero (~45 unidades) llega cacheado y se filtra en el
// cliente. El server NO lee searchParams ni cookies (la URL la lee el cliente).
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Alojamiento en Córdoba",
  description:
    "Departamentos para estadías cortas o por mes en Córdoba capital. Elegí fechas, pedí sin pagar nada y te confirmamos por WhatsApp.",
  alternates: { canonical: "/buscar" },
};

export default async function BuscarPage() {
  const [catalog, contact] = await Promise.all([getStorefrontCatalog(), getSiteContact()]);

  // SearchResultsClient lee la URL (useSearchParams), así que en esta página
  // estática se dibuja recién en el cliente. El fallback NO es un esqueleto: es
  // el resultado por defecto (sin filtros) ya dibujado en el servidor, para que
  // buscadores, quien no tiene JS y el primer pintado vean el H1 y las fichas.
  return (
    <Suspense fallback={<SearchResultsFallback catalog={catalog} whatsappNumber={contact.whatsappNumber} />}>
      <SearchResultsClient catalog={catalog} whatsappNumber={contact.whatsappNumber} />
    </Suspense>
  );
}
