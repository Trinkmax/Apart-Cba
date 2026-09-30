import { Instagram, Mail, MessageCircle } from "lucide-react";
import { ArcBand, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { cn } from "@/lib/utils";

/**
 * Banda de contacto de las páginas de contenido ("Cómo reservar",
 * "Propietarios"). Muestra sólo los canales configurados en Configuración →
 * Web y cobros; si no hay ninguno, deja un texto que no promete un canal que
 * no existe.
 */
export function ContactBand({
  title = "¿Te quedó alguna duda?",
  accent = "Escribinos: del otro lado hay personas.",
  whatsappUrl,
  whatsappLabel,
  email,
  instagram,
  fallback = "Cuando pidas tus fechas, te escribimos nosotros por WhatsApp y mail.",
  className,
}: {
  title?: string;
  accent?: string;
  /** Link wa.me con el mensaje precargado; null si no hay número. */
  whatsappUrl: string | null;
  /** Número formateado para leer ("+54 9 351 …"). */
  whatsappLabel?: string | null;
  email: string | null;
  /** Usuario sin @. */
  instagram: string | null;
  /** Texto cuando no hay ningún canal configurado. */
  fallback?: string;
  className?: string;
}) {
  const hasAny = Boolean(whatsappUrl || email || instagram);
  return (
    <section className={cn("px-2 sm:px-4 lg:px-6", className)} aria-labelledby="contact-band-title">
      <div className="m-rise relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] bg-leaf-100 px-5 py-12 max-sm:py-10 sm:rounded-[2.5rem] sm:px-10 sm:py-16 lg:px-16">
        <ArcBand
          thickness={12}
          className="absolute -bottom-2 -right-10 w-48 text-leaf-300 sm:w-64 lg:-right-6 lg:w-80"
        />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h2
              id="contact-band-title"
              className="font-apart text-[1.75rem] font-extrabold leading-[1.08] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]"
            >
              {title}
              <BrandDot />
            </h2>
            <p className="mt-3 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">{accent}</p>
            {!hasAny ? <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-700">{fallback}</p> : null}
          </div>

          {hasAny ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:justify-end">
              {whatsappUrl ? (
                <ApartButton asChild variant="primary" size="lg" className="w-full sm:w-auto">
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle aria-hidden />
                    <span>
                      WhatsApp
                      {whatsappLabel ? (
                        <span className="ml-1.5 font-medium text-cream/80 tabular-nums">{whatsappLabel}</span>
                      ) : null}
                    </span>
                  </a>
                </ApartButton>
              ) : null}
              {email ? (
                <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                  <a href={`mailto:${email}`}>
                    <Mail aria-hidden />
                    <span className="max-w-[16rem] truncate">{email}</span>
                  </a>
                </ApartButton>
              ) : null}
              {instagram ? (
                <ApartButton asChild variant="ghost" size="lg" className="w-full sm:w-auto">
                  <a
                    href={`https://www.instagram.com/${encodeURIComponent(instagram)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Instagram aria-hidden />@{instagram}
                  </a>
                </ApartButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
