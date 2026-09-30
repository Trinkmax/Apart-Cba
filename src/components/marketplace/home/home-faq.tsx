import Link from "next/link";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";
import { FaqList, type FaqItem } from "./faq-list";

const linkClass =
  "inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700";

/** Preguntas frecuentes de la home (4) + atajo a "Cómo reservar". */
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
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-8">
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading eyebrow="Preguntas frecuentes" title="Lo que más nos preguntan" />
          <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-ink-700">
            ¿Te quedó alguna duda? Escribinos y te respondemos.
          </p>
          <div className="mt-7 flex flex-col items-start gap-3">
            <Link
              href="/como-reservar"
              className="group inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700"
            >
              Cómo reservar, paso a paso
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            {whatsappUrl ? (
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                <MessageCircle className="size-4" aria-hidden />
                Consultar por WhatsApp
              </a>
            ) : mailtoUrl ? (
              <a href={mailtoUrl} className={linkClass}>
                <Mail className="size-4" aria-hidden />
                Consultar por mail
              </a>
            ) : null}
          </div>
        </Reveal>
        <Reveal delay={100} y={16}>
          <FaqList items={items} />
        </Reveal>
      </div>
    </section>
  );
}
