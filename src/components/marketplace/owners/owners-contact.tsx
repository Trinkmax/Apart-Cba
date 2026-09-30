import { Mail, MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { BrandPhoto } from "@/components/marketplace/home/brand-photo";
import { Reveal } from "@/components/marketplace/reveal";
import { OwnerLeadForm } from "./owner-lead-form";

/**
 * Cierre de "Propietarios": el formulario (→ submitOwnerLead) y, al lado, los
 * canales directos que estén configurados. Es el ancla `#contacto` del hero.
 */
export function OwnersContact({
  responseHours,
  whatsappUrl,
  whatsappLabel,
  email,
}: {
  responseHours: number;
  whatsappUrl: string | null;
  whatsappLabel: string | null;
  email: string | null;
}) {
  const hasDirect = Boolean(whatsappUrl || email);
  return (
    <section id="contacto" aria-labelledby="owners-contact-title" className="scroll-mt-20 py-16 sm:py-24 lg:scroll-mt-24">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16 lg:px-8">
        <Reveal className="lg:pt-4">
          <SectionHeading
            eyebrow="Hablemos"
            title={<span id="owners-contact-title">¿Tenés un departamento en Córdoba?</span>}
            accent="Nosotros lo cuidamos."
          />
          <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-ink-700">
            Contanos dónde está y cómo es. Te escribimos para conocerlo y contarte cómo trabajamos.
          </p>

          {hasDirect ? (
            <div className="mt-8">
              <p className="text-sm font-bold text-forest-700">¿Preferís escribirnos directo?</p>
              <ul className="mt-3 space-y-1">
                {whatsappUrl ? (
                  <li>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex min-h-11 items-center gap-3 font-semibold text-forest-700"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full bg-leaf-200">
                        <MessageCircle className="size-4" aria-hidden />
                      </span>
                      <span className="underline decoration-forest-700/25 underline-offset-4 group-hover:decoration-forest-700">
                        WhatsApp{whatsappLabel ? <span className="tabular-nums"> {whatsappLabel}</span> : null}
                      </span>
                    </a>
                  </li>
                ) : null}
                {email ? (
                  <li>
                    <a
                      href={`mailto:${email}`}
                      className="group inline-flex min-h-11 items-center gap-3 font-semibold text-forest-700"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full bg-leaf-200">
                        <Mail className="size-4" aria-hidden />
                      </span>
                      <span className="break-all underline decoration-forest-700/25 underline-offset-4 group-hover:decoration-forest-700">
                        {email}
                      </span>
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <figure className="mt-12 hidden w-full max-w-[17rem] lg:block">
            <div className="aspect-square overflow-hidden rounded-t-full rounded-b-3xl bg-cream-300 shadow-apart-md">
              <BrandPhoto
                name="cuidado-cama"
                alt="Manos acomodando un almohadón sobre una cama recién tendida"
                sizes="17rem"
                className="object-center"
              />
            </div>
            <figcaption className="mt-3 font-apart-serif text-lg italic text-forest-600">Cuidemos el lugar.</figcaption>
          </figure>
        </Reveal>

        <Reveal delay={100} y={16}>
          <OwnerLeadForm responseHours={responseHours} whatsappUrl={whatsappUrl} />
        </Reveal>
      </div>
    </section>
  );
}
