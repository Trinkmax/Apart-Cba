import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CalendarHeart, KeyRound, MessageCircleHeart, WalletCards } from "lucide-react";
import { ArcBand, SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { ProcessSteps } from "@/components/marketplace/brand/process-steps";
import { Reveal } from "@/components/marketplace/reveal";
import { cn } from "@/lib/utils";
import { BrandPhoto } from "./brand-photo";

/**
 * "Así de simple": el proceso real (pedido sin pago → confirmación → seña
 * por transferencia → resto al llegar) con la política de la organización.
 * Desde lg: ProcessSteps + la foto de las llaves. Por debajo: un mazo de
 * cuatro tarjetas que se van tapando al bajar (sticky), sin la foto.
 */
export function HomeProcess({ responseHours, senaLabel }: { responseHours: number; senaLabel: string | null }) {
  return (
    <section className="px-2 sm:px-4 lg:px-6">
      <div
        className={cn(
          "relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] bg-cream-200 px-4 py-14 sm:rounded-[2.5rem] sm:px-8 sm:py-20 lg:px-12 lg:py-24",
          // < lg: `clip` y no `hidden` (hidden crea un contenedor de scroll y el sticky
          // del mazo deja de pegarse); abajo sobra aire porque "Por mes" se encima.
          "max-lg:overflow-clip max-lg:pb-14 max-lg:pt-10 sm:max-lg:pb-16 sm:max-lg:pt-14",
        )}
      >
        <ArcBand
          thickness={10}
          className="absolute -left-10 -top-6 w-44 rotate-180 text-leaf-300/60 sm:w-56 lg:-left-14 lg:w-72"
        />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-16">
          <div>
            <Reveal>
              <SectionHeading
                eyebrow="Cómo se reserva"
                title="Reservar con nosotros es así de simple"
                accent="Primero te confirmamos. Después pagás."
              />
            </Reveal>
            <Reveal delay={120} y={16} className="max-lg:hidden">
              <ProcessSteps
                responseHours={responseHours}
                senaLabel={senaLabel}
                className="mt-10 gap-x-8 gap-y-9 sm:mt-12 lg:grid-cols-2"
              />
            </Reveal>
            <ProcessDeck responseHours={responseHours} senaLabel={senaLabel} />
            <Reveal delay={200} y={10}>
              <Link
                href="/como-reservar"
                className="group mt-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-paper px-5 text-[0.9375rem] font-bold text-forest-700 shadow-apart-sm ring-1 ring-cream-300 transition-colors hover:bg-white max-lg:mt-6"
              >
                Cómo reservar, paso a paso
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </Reveal>
          </div>

          <Reveal y={24} className="relative mx-auto w-full max-w-[26rem] max-lg:hidden lg:max-w-none">
            <div className="aspect-[4/5] overflow-hidden rounded-t-full rounded-b-3xl bg-cream-300 shadow-apart-md">
              <BrandPhoto
                name="llaves"
                alt="Llaveros de apart en forma de arco, con las llaves de un departamento"
                sizes="(min-width: 1024px) 34vw, (min-width: 640px) 26rem, 92vw"
                className="object-[46%_50%]"
              />
            </div>
            <span
              aria-hidden
              className="absolute -right-2 top-[18%] size-10 rounded-full bg-coral-500 shadow-apart-sm sm:-right-4 sm:size-12"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** Fondos alternados del mazo: papel, salvia, forest (texto crema) y coral claro. */
const DECK_TONES = [
  { card: "bg-paper ring-1 ring-cream-300", num: "text-coral-500", icon: "bg-leaf-200 text-forest-700", title: "text-forest-700", body: "text-ink-600" },
  { card: "bg-leaf-100 ring-1 ring-leaf-200", num: "text-coral-500", icon: "bg-paper text-forest-700", title: "text-forest-700", body: "text-ink-700" },
  { card: "bg-forest-700", num: "text-coral-300", icon: "bg-leaf-300 text-forest-700", title: "text-cream", body: "text-cream/85" },
  { card: "bg-coral-50 ring-1 ring-coral-100", num: "text-coral-600", icon: "bg-paper text-coral-600", title: "text-forest-700", body: "text-ink-700" },
] as const;

/**
 * Celular y tablet: los mismos cuatro pasos de ProcessSteps (títulos iguales y
 * una sola frase de cada bajada) como tarjetas grandes apiladas. Cada una se
 * pega un poco más abajo que la anterior (`--i`) y la siguiente la tapa al subir:
 * queda un mazo. Los textos salen de ProcessSteps (recortados): si cambia el
 * proceso, hay que tocar los dos.
 */
function ProcessDeck({ responseHours, senaLabel }: { responseHours: number; senaLabel: string | null }) {
  const hours = responseHours === 1 ? "1 hora" : `${responseHours} horas`;
  const steps = [
    { icon: CalendarHeart, title: "Pedís tus fechas", body: "Todavía no pagás nada." },
    { icon: MessageCircleHeart, title: "Te confirmamos", body: `Te respondemos en menos de ${hours}, por WhatsApp y mail.` },
    senaLabel
      ? { icon: WalletCards, title: `Señás ${senaLabel}`, body: "Transferís la seña para asegurar tus fechas." }
      : { icon: WalletCards, title: "Sin seña", body: "No hace falta adelantar nada para asegurar tus fechas." },
    { icon: KeyRound, title: "El resto, al llegar", body: "Pagás el saldo el día que te entregamos las llaves." },
  ];

  return (
    <ol className="mt-7 space-y-3 lg:hidden">
      {steps.map((s, i) => {
        const tone = DECK_TONES[i];
        return (
          <li
            key={s.title}
            style={{ "--i": i } as CSSProperties}
            className={cn(
              // Todas del mismo alto: si una fuera más baja, la de atrás asomaría por abajo.
              "sticky top-[calc(5rem+var(--i)*0.75rem)] min-h-[8rem] rounded-[1.75rem] p-4 shadow-apart-md sm:min-h-[8.5rem] sm:p-5",
              tone.card,
            )}
          >
            <div className="flex items-center gap-3">
              <span aria-hidden className={cn("w-7 shrink-0 font-apart-serif text-[2.5rem] italic leading-none", tone.num)}>
                {i + 1}
              </span>
              <p className={cn("min-w-0 flex-1 text-lg font-extrabold leading-tight tracking-[-0.01em]", tone.title)}>
                {s.title}
              </p>
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-t-full rounded-b-lg", tone.icon)}>
                <s.icon className="size-[1.125rem]" aria-hidden />
              </span>
            </div>
            <p className={cn("mt-2 text-[0.9375rem] leading-relaxed", tone.body)}>{s.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
