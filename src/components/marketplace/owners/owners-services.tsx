import { CalendarCheck2, FileText, KeyRound, RefreshCw, Sparkles, UserRoundCheck, type LucideIcon } from "lucide-react";
import { ArcBand, SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { SnapRail } from "@/components/marketplace/brand/snap-rail";
// Server component: las clases del riel salen del módulo SIN "use client" (desde
// snap-rail.tsx llegarían como referencias de cliente y cn() las descartaría).
import { MOBILE_RAIL_ITEM } from "@/components/marketplace/brand/snap-rail-classes";
import { Reveal } from "@/components/marketplace/reveal";
import { cn } from "@/lib/utils";

/**
 * "Qué hacemos": sólo lo que el equipo hace de verdad con el sistema
 * (publicación multicanal con calendario sincronizado, atención, limpieza y
 * mantenimiento, liquidación mensual y acceso del propietario). Nada de
 * promesas de ocupación ni de rentabilidad.
 */
const SERVICES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: KeyRound,
    title: "Atención de huéspedes, de punta a punta",
    body: "Respondemos las consultas, confirmamos cada reserva, coordinamos la llegada y la entrega de llaves, y estamos durante toda la estadía.",
  },
  {
    icon: Sparkles,
    title: "Limpieza y mantenimiento coordinados",
    body: "Organizamos la limpieza entre una estadía y otra, y resolvemos los arreglos del día a día con nuestro equipo.",
  },
  {
    icon: FileText,
    title: "Una liquidación clara, todos los meses",
    body: "Te mandamos la liquidación mensual con el detalle de cada reserva, para que sepas de dónde sale cada número.",
  },
  {
    icon: UserRoundCheck,
    title: "Tu acceso, cuando quieras",
    body: "Entrás con tu usuario y ves las reservas de tu departamento y tus liquidaciones.",
  },
];

const CHANNELS = ["Airbnb", "Booking.com", "Nuestra web"];

export function OwnersServices() {
  return (
    <section aria-labelledby="owners-services-title" className="py-16 max-sm:py-12 sm:py-24 sm:max-lg:py-16">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Qué hacemos"
            title={<span id="owners-services-title">Nos ocupamos de todo, con vos al tanto</span>}
            accent="Vos sabés qué pasa con tu propiedad. Nosotros hacemos que funcione."
          />
        </Reveal>

        {/* Celular/tablet: riel con snap (la tarjeta siguiente asomada). Escritorio: la
            misma grilla de siempre (grid, 3 columnas, gap-5, mt-12). */}
        <SnapRail as="ul" label="Qué hacemos" className="mt-10 sm:mt-12 lg:grid lg:grid-cols-3 lg:gap-5">
          <Reveal
            as="li"
            y={16}
            className={cn(
              "relative isolate overflow-hidden rounded-3xl bg-forest-700 p-6 text-cream shadow-apart-md sm:p-8 md:col-span-2",
              MOBILE_RAIL_ITEM,
            )}
          >
            <ArcBand
              thickness={12}
              className="absolute -right-12 -top-2 -z-10 w-56 rotate-180 text-coral-500/80 sm:w-72"
            />
            <span className="flex size-12 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-300 text-forest-700">
              <CalendarCheck2 className="size-5" aria-hidden />
            </span>
            <h3 className="mt-5 max-w-md font-apart text-2xl font-extrabold leading-[1.15] tracking-[-0.02em] sm:text-[1.75rem]">
              Publicamos tu departamento donde se reserva
            </h3>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-cream/85 sm:text-base">
              Lo ofrecemos en Airbnb, en Booking.com y en nuestra web, con el calendario sincronizado entre todos los
              canales.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {CHANNELS.map((c, i) => (
                <span key={c} className="flex items-center gap-2">
                  <span className="inline-flex h-9 items-center rounded-full bg-cream/10 px-4 text-sm font-semibold text-cream ring-1 ring-cream/20">
                    {c}
                  </span>
                  {i < CHANNELS.length - 1 ? <span aria-hidden className="h-px w-3 bg-leaf-300/50" /> : null}
                </span>
              ))}
              <span className="ml-1 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-300">
                <RefreshCw className="size-4" aria-hidden />
                Un solo calendario
              </span>
            </div>
          </Reveal>

          {SERVICES.map((s, i) => (
            <Reveal
              as="li"
              key={s.title}
              delay={(i + 1) * 80}
              y={16}
              className={cn(
                "rounded-3xl bg-paper p-6 shadow-apart-sm ring-1 ring-cream-300 sm:p-7",
                "transition-[box-shadow,transform] duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-apart-md",
                MOBILE_RAIL_ITEM,
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-200 text-forest-700">
                <s.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-lg font-extrabold leading-snug tracking-[-0.01em] text-forest-700">{s.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-700">{s.body}</p>
            </Reveal>
          ))}
        </SnapRail>
      </div>
    </section>
  );
}
