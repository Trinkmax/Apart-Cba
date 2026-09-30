import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { ProcessSteps } from "@/components/marketplace/brand/process-steps";
import { ContactBand } from "@/components/marketplace/home/contact-band";
import { ContentHero } from "@/components/marketplace/home/content-hero";
import { howToFaqItems, processFacts } from "@/components/marketplace/home/faq-content";
import { FaqList } from "@/components/marketplace/home/faq-list";
import {
  CancelacionesSection,
  ConfirmacionSection,
  LlegadaSection,
  PagosSection,
  PedidoSection,
  PorMesSection,
} from "@/components/marketplace/home/how-to-sections";
import { PageToc, type TocItem } from "@/components/marketplace/home/page-toc";
import { formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { consultMailto } from "@/lib/marketplace/widget-quote";
import { hoursLabel, resolveWebSettings } from "@/lib/marketplace/web-settings";
import { getResolvedWebSettings, getSiteContact } from "@/lib/marketplace/web-settings-server";

/**
 * "Cómo reservar": el proceso real, paso a paso, con la política de la
 * organización (Configuración → Web y cobros). Estática con ISR: no lee
 * cookies. Sus anclas (#pedido, #pagos, #cancelaciones…) las usan el footer,
 * los mails y la ficha de cada alojamiento.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Cómo reservar",
  description:
    "Pedís tus fechas sin pagar nada, te confirmamos, señás y el resto lo pagás al llegar. Así se reserva un departamento de apart en Córdoba.",
  alternates: { canonical: "/como-reservar" },
};

const TOC: TocItem[] = [
  { id: "pedido", label: "El pedido" },
  { id: "confirmacion", label: "La confirmación" },
  { id: "pagos", label: "Seña y pagos" },
  { id: "llegada", label: "La llegada" },
  { id: "por-mes", label: "Estadías por mes" },
  { id: "cancelaciones", label: "Cancelaciones" },
  { id: "preguntas", label: "Preguntas" },
];

export default async function ComoReservarPage() {
  const contact = await getSiteContact();
  const settings = contact.organizationId
    ? await getResolvedWebSettings(contact.organizationId)
    : resolveWebSettings(null);

  const whatsappUrl = whatsappLink(contact.whatsappNumber, "Hola, tengo una consulta sobre cómo reservar.");
  const monthlyText = "Hola, quiero consultar por una estadía por mes en Córdoba.";
  const monthlyWhatsapp = whatsappLink(contact.whatsappNumber, monthlyText);
  // Sin WhatsApp configurado, la consulta va por mail (nunca un botón sin destino).
  const monthlyMailto = consultMailto(contact.publicEmail, "Consulta por una estadía por mes", monthlyText);
  const facts = processFacts(settings, whatsappUrl);
  const payLine = facts.senaLabel
    ? `Señás ${facts.senaLabel} y el resto lo pagás al llegar.`
    : "Y pagás al llegar.";

  return (
    <>
      <ContentHero
        id="como-reservar"
        eyebrow="Cómo reservar"
        strong="Reservar es"
        soft="así de simple"
        accent="Primero te confirmamos. Después pagás."
        lead={
          <p>
            Pedís tus fechas sin pagar nada y te confirmamos en menos de {hoursLabel(facts.responseHours)}.{" "}
            {payLine} Sin tarjetas, sin cobros online.
          </p>
        }
        photo={{
          name: "llaves",
          alt: "Llaveros de apart en forma de arco, con las llaves de un departamento",
          position: "object-[46%_50%]",
        }}
        caption="Llegar debe sentirse simple."
      >
        <ApartButton asChild variant="cta" size="lg">
          <Link href="/buscar">
            <Search aria-hidden />
            Buscar alojamiento
          </Link>
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

      <section aria-labelledby="pasos-title" className="px-2 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-[1400px] rounded-[2rem] bg-cream-200 px-4 py-12 sm:rounded-[2.5rem] sm:px-8 sm:py-16 lg:px-12">
          <div className="mx-auto max-w-[1240px]">
            <Eyebrow>
              <span id="pasos-title">En cuatro pasos</span>
            </Eyebrow>
            <ProcessSteps
              responseHours={facts.responseHours}
              senaLabel={facts.senaLabel}
              className="mt-8 gap-x-8 gap-y-9"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6 sm:py-20 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-24 xl:gap-24">
        <aside className="hidden lg:block">
          <PageToc items={TOC} variant="aside" className="sticky top-28" />
        </aside>
        <div className="min-w-0">
          <PageToc items={TOC} variant="chips" className="mb-12 lg:hidden" />
          <div className="max-w-3xl space-y-16 sm:space-y-20">
            <PedidoSection />
            <ConfirmacionSection responseHours={facts.responseHours} />
            <PagosSection facts={facts} />
            <LlegadaSection />
            <PorMesSection whatsappUrl={monthlyWhatsapp} mailtoUrl={monthlyMailto} />
            <CancelacionesSection customText={settings.cancellationText} />
            <section id="preguntas" aria-labelledby="preguntas-title" className="scroll-mt-24 lg:scroll-mt-28">
              <h2
                id="preguntas-title"
                className="font-apart text-2xl font-extrabold leading-[1.1] tracking-[-0.02em] text-forest-700 sm:text-[2rem]"
              >
                Preguntas frecuentes
              </h2>
              <FaqList items={howToFaqItems(facts)} className="mt-6" />
            </section>
          </div>
        </div>
      </div>

      <ContactBand
        whatsappUrl={whatsappUrl}
        whatsappLabel={formatPhoneAR(contact.whatsappNumber)}
        email={contact.publicEmail}
        instagram={contact.instagramHandle}
        className="pb-16 sm:pb-24"
      />
    </>
  );
}
