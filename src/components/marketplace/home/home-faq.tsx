import Link from "next/link";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";
import { FaqList, type FaqItem } from "./faq-list";

const linkClass =
  "inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700";

/**
 * Preguntas frecuentes de la home (4) + atajo a "Cómo reservar".
 * Celular y tablet: primero las preguntas y al final, compacto, "¿Te quedó
 * alguna duda?" con el botón de contacto (el atajo a "Cómo reservar" ya está
 * en la sección del proceso).
 */
export function HomeFaq({
  items,
  whatsappUrl,
  mailtoUrl = null,
}: {
  items: FaqItem[];
  whatsappUrl: string | null;
  /** Consulta por mail si no hay WhatsApp configurado. */
  mailtoUrl?: string | null;
}) {
  const contact = whatsappUrl
    ? { href: whatsappUrl, external: true, icon: MessageCircle, label: "Consultar por WhatsApp", via: "por WhatsApp" }
    : mailtoUrl
      ? { href: mailtoUrl, external: false, icon: Mail, label: "Consultar por mail", via: "por mail" }
      : null;

  return (
    <section className="py-10 sm:py-24 sm:max-lg:py-16">
      <div className="mx-auto grid max-w-[1240px] gap-7 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-8">
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading eyebrow="Preguntas frecuentes" title="Lo que más nos preguntan" />
          <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-ink-700 max-lg:hidden">
            ¿Te quedó alguna duda? Escribinos y te respondemos.
          </p>
          <div className="mt-7 flex flex-col items-start gap-3 max-lg:hidden">
            <Link
              href="/como-reservar"
              className="group inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700"
            >
              Cómo reservar, paso a paso
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            {contact ? (
              <a
                href={contact.href}
                {...(contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={linkClass}
              >
                <contact.icon className="size-4" aria-hidden />
                {contact.label}
              </a>
            ) : null}
          </div>
        </Reveal>
        <Reveal delay={100} y={16}>
          <FaqList items={items} />
        </Reveal>
        {contact ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:hidden">
            <p className="text-[0.9375rem] font-semibold text-forest-700">¿Te quedó alguna duda?</p>
            <a
              href={contact.href}
              {...(contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest-700 px-5 text-[0.9375rem] font-bold text-cream shadow-apart-sm transition-colors hover:bg-forest-800 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
            >
              <contact.icon className="size-4" aria-hidden />
              <span>
                Escribinos<span className="sr-only"> {contact.via}</span>
              </span>
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
