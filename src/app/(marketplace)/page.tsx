import type { Metadata } from "next";
import { HomeFaq } from "@/components/marketplace/home/home-faq";
import { HomeFeatured } from "@/components/marketplace/home/home-featured";
import { HomeHero } from "@/components/marketplace/home/home-hero";
import { HomeHoods } from "@/components/marketplace/home/home-hoods";
import { HomeMonthly } from "@/components/marketplace/home/home-monthly";
import { HomeOwnersBand } from "@/components/marketplace/home/home-owners-band";
import { HomePillars } from "@/components/marketplace/home/home-pillars";
import { HomeProcess } from "@/components/marketplace/home/home-process";
import { HomeStory } from "@/components/marketplace/home/home-story";
import { homeFaqItems, processFacts } from "@/components/marketplace/home/faq-content";
import {
  catalogStats,
  hoodTiles,
  pickFeaturedListings,
  unitsInHoodsLabel,
} from "@/components/marketplace/home/home-data";
import { absoluteUrl, getAppUrl } from "@/lib/app-url";
import { whatsappLink } from "@/lib/marketplace/display";
import { getStorefrontCatalog } from "@/lib/marketplace/storefront";
import { resolveWebSettings } from "@/lib/marketplace/web-settings";
import { consultMailto } from "@/lib/marketplace/widget-quote";
import { getResolvedWebSettings, getSiteContact } from "@/lib/marketplace/web-settings-server";

/**
 * Home de la web pública. ISR: se arma en el server cada 5 minutos a partir
 * del catálogo cacheado; no lee cookies, headers ni searchParams (el estado
 * del huésped lo resuelve el header en el cliente).
 */
export const revalidate = 300;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function MarketplaceHome() {
  const [catalog, contact] = await Promise.all([getStorefrontCatalog(), getSiteContact()]);
  const settings = contact.organizationId
    ? await getResolvedWebSettings(contact.organizationId)
    : resolveWebSettings(null);

  const stats = catalogStats(catalog);
  const facts = processFacts(
    settings,
    whatsappLink(contact.whatsappNumber, "Hola, tengo una consulta sobre cómo reservar."),
  );
  const monthlyText = "Hola, quiero consultar por una estadía por mes en Córdoba.";
  const monthlyWhatsapp = whatsappLink(contact.whatsappNumber, monthlyText);
  // Sin WhatsApp configurado, las consultas van por mail (nunca un botón sin destino).
  const monthlyMailto = consultMailto(contact.publicEmail, "Consulta por una estadía por mes", monthlyText);
  const faqMailto = consultMailto(
    contact.publicEmail,
    "Consulta sobre cómo reservar",
    "Hola, tengo una consulta sobre cómo reservar.",
  );

  return (
    <>
      <HomeJsonLd instagram={contact.instagramHandle} />
      <HomeHero
        responseHours={facts.responseHours}
        senaLabel={facts.senaLabel}
        // Lleva a /buscar ("Por noche"): cuenta lo mismo que muestra ese destino.
        statsLabel={unitsInHoodsLabel(stats.shortStays, stats.shortHoods)}
      />
      <HomePillars />
      <HomeFeatured listings={pickFeaturedListings(catalog.listings)} total={stats.shortStays} />
      {/* En celular y tablet los barrios van antes del proceso (lo visual antes que el
          texto). El contenedor es flex SÓLO por debajo de lg: en escritorio es un div
          en bloque sin estilos (las secciones no tienen márgenes) y manda el orden del código. */}
      <div className="max-lg:flex max-lg:flex-col">
        <HomeProcess responseHours={facts.responseHours} senaLabel={facts.senaLabel} />
        <HomeHoods tiles={hoodTiles(catalog, { limit: 10 })} className="max-lg:order-first" />
      </div>
      <HomeMonthly monthlyCount={stats.monthly} whatsappUrl={monthlyWhatsapp} mailtoUrl={monthlyMailto} />
      <HomeStory />
      <HomeOwnersBand />
      <HomeFaq items={homeFaqItems(facts)} whatsappUrl={facts.whatsappUrl} mailtoUrl={faqMailto} />
    </>
  );
}

/** Datos estructurados de la marca (sin inventar: sólo lo que está configurado). */
function HomeJsonLd({ instagram }: { instagram: string | null }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "apart",
    alternateName: "Apart CBA",
    description: "Alquileres temporarios en Córdoba, por noches o por meses.",
    url: getAppUrl(),
    logo: absoluteUrl("/apart/icons/apart-512.png"),
    areaServed: { "@type": "City", name: "Córdoba, Argentina" },
    ...(instagram ? { sameAs: [`https://www.instagram.com/${instagram}`] } : {}),
  };
  return (
    <script
      type="application/ld+json"
      // JSON.stringify no escapa "<": se reemplaza para que un dato nunca cierre el <script>.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
