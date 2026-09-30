import type { Metadata } from "next";
import { ArrowDown, MessageCircle } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ContentHero } from "@/components/marketplace/home/content-hero";
import { OwnersContact } from "@/components/marketplace/owners/owners-contact";
import { OwnersServices } from "@/components/marketplace/owners/owners-services";
import { OwnersSteps } from "@/components/marketplace/owners/owners-steps";
import { formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { resolveWebSettings } from "@/lib/marketplace/web-settings";
import { getResolvedWebSettings, getSiteContact } from "@/lib/marketplace/web-settings-server";

/**
 * "Propietarios": qué hace apart por un departamento (sólo hechos del sistema
 * real) y el formulario de contacto (→ submitOwnerLead). Estática con ISR;
 * reemplaza al viejo "Publicar mi unidad", que llevaba al login del panel.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Propietarios",
  description:
    "¿Tenés un departamento en Córdoba? Lo publicamos en Airbnb, Booking.com y nuestra web, atendemos a cada huésped, coordinamos limpieza y mantenimiento y te liquidamos todos los meses.",
  alternates: { canonical: "/propietarios" },
};

export default async function PropietariosPage() {
  const contact = await getSiteContact();
  const settings = contact.organizationId
    ? await getResolvedWebSettings(contact.organizationId)
    : resolveWebSettings(null);
  const whatsappUrl = whatsappLink(
    contact.whatsappNumber,
    "Hola, tengo un departamento en Córdoba y quiero saber cómo trabajan con propietarios.",
  );

  return (
    <>
      <ContentHero
        id="propietarios"
        eyebrow="Propietarios"
        strong="Tu propiedad,"
        soft="en buenas manos"
        accent="Todo en su lugar. También los papeles."
        lead={
          <p>
            Publicamos tu departamento, atendemos a cada huésped, coordinamos la limpieza y el mantenimiento, y todos
            los meses te rendimos cuentas con el detalle de cada reserva.
          </p>
        }
        photo={{
          name: "hacemos-lugar",
          alt: "Espacio de trabajo con un arco verde pintado en la pared y el cartel «Hacemos lugar. Para personas, ideas y llegadas.»",
          position: "object-[44%_50%]",
        }}
      >
        <ApartButton asChild variant="cta" size="lg">
          <a href="#contacto">
            Quiero que me contacten
            <ArrowDown aria-hidden />
          </a>
        </ApartButton>
        {whatsappUrl ? (
          <ApartButton asChild variant="secondary" size="lg">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden />
              Consultar por WhatsApp
            </a>
          </ApartButton>
        ) : null}
      </ContentHero>

      <OwnersServices />
      <OwnersSteps responseHours={settings.responseHours} hasWhatsapp={Boolean(whatsappUrl)} />
      <OwnersContact
        responseHours={settings.responseHours}
        whatsappUrl={whatsappUrl}
        whatsappLabel={formatPhoneAR(contact.whatsappNumber)}
        email={contact.publicEmail}
      />
    </>
  );
}
