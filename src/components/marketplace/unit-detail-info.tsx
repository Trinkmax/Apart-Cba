import { ScrollText, WalletCards } from "lucide-react";
import type { StorefrontListingDetail } from "@/lib/marketplace/contracts";
import type { Review } from "@/lib/types/database";
import { AmenitiesBlock, type AmenityItem } from "@/components/marketplace/listing/amenities-block";
import { DescriptionBlock } from "@/components/marketplace/listing/description-block";
import { DetailDisclosure, DetailSection } from "@/components/marketplace/listing/detail-section";
import { BookingModeNote } from "@/components/marketplace/listing/booking-mode-note";
import { KeyFacts } from "@/components/marketplace/listing/key-facts";
import { LocationBlock } from "@/components/marketplace/listing/location-block";
import { PaymentSteps, PaymentSummary } from "@/components/marketplace/listing/payment-steps";
import { ReviewsBlock } from "@/components/marketplace/listing/reviews-block";
import { RulesBlock, rulesSummary } from "@/components/marketplace/listing/rules-block";
import { TeamCard } from "@/components/marketplace/listing/team-card";

/**
 * Columna izquierda de la ficha: lo importante, cómo se reserva, descripción,
 * comodidades, cómo se paga, reglas y cancelación, ubicación, el equipo y las
 * reseñas (sólo si hay). Server component: las partes interactivas (Leer más,
 * comodidades, pasos con la seña, WhatsApp) son clientes y leen el estado de
 * la estadía de ListingStayProvider.
 */
export function UnitDetailInfo({
  listing,
  amenities,
  reviews,
  settings,
}: {
  listing: StorefrontListingDetail;
  amenities: AmenityItem[];
  reviews: Review[];
  settings: { responseHours: number; cancellationText: string | null };
}) {
  const description = listing.marketplace_description?.trim() ? listing.marketplace_description : null;
  const rules = (
    <RulesBlock houseRules={listing.house_rules} policy={listing.cancellation_policy} cancellationText={settings.cancellationText} />
  );
  return (
    <div className="space-y-8 md:space-y-10">
      <DetailSection id="lo-importante" title="Lo importante" className="border-t-0 pt-0 md:pt-0">
        <KeyFacts listing={listing} />
        <div className="mt-7">
          <BookingModeNote />
        </div>
      </DetailSection>

      {description ? (
        <DetailSection id="sobre-este-lugar" title="Sobre este lugar">
          <DescriptionBlock text={description} />
        </DetailSection>
      ) : null}

      {amenities.length > 0 ? (
        <DetailSection id="comodidades" title="Comodidades">
          <AmenitiesBlock amenities={amenities} />
        </DetailSection>
      ) : null}

      {/* Cómo se paga y Reglas: en escritorio, abiertas como siempre (hidden lg:block);
          por debajo de lg, plegadas con un resumen de una línea (lg:hidden). */}
      <DetailSection id="como-se-paga" title="Cómo se paga" accent="Llegar debe sentirse simple." className="hidden lg:block">
        <PaymentSteps />
      </DetailSection>
      <DetailDisclosure id="como-se-paga-celular" title="Cómo se paga" icon={WalletCards} summary={<PaymentSummary />} className="lg:hidden">
        <PaymentSteps />
      </DetailDisclosure>

      <DetailSection id="reglas" title="Reglas y cancelación" accent="Cuidemos el lugar." className="hidden lg:block">
        {rules}
      </DetailSection>
      <DetailDisclosure
        id="reglas-celular"
        title="Reglas y cancelación"
        icon={ScrollText}
        summary={rulesSummary(listing.house_rules, listing.cancellation_policy, settings.cancellationText)}
        className="lg:hidden"
      >
        {rules}
      </DetailDisclosure>

      <DetailSection id="ubicacion" title="Dónde vas a estar">
        <LocationBlock latitude={listing.latitude} longitude={listing.longitude} hood={listing.hood} city={listing.city} />
      </DetailSection>

      <div className="border-t border-cream-300 pt-8 md:pt-10">
        <TeamCard />
      </div>

      {reviews.length > 0 ? (
        <DetailSection id="resenas" title="Reseñas">
          <ReviewsBlock reviews={reviews} />
        </DetailSection>
      ) : null}
    </div>
  );
}
