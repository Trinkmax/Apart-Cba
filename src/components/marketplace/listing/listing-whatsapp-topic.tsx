"use client";

import { WhatsAppFloatTopic } from "@/components/marketplace/shell/whatsapp-float";
import { useListingStay } from "./stay-context";

/**
 * En la ficha, el botón flotante de WhatsApp consulta por esta unidad con las
 * fechas y huéspedes elegidos (el mismo mensaje que "Consultar" del widget).
 */
export function ListingWhatsAppTopic() {
  const { consult } = useListingStay();
  return <WhatsAppFloatTopic url={consult.whatsappUrl} />;
}
