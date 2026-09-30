import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  CalendarHeart,
  CalendarRange,
  CircleCheck,
  Hourglass,
  KeyRound,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  MessageCircleHeart,
  Send,
  ShieldCheck,
  Undo2,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { cancellationCopy } from "@/lib/marketplace/display";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { cn } from "@/lib/utils";
import { BrandPhoto } from "./brand-photo";
import { REQUEST_EXPIRY_HOURS, type ProcessFacts } from "./faq-content";

/**
 * Secciones de "Cómo reservar". Cada una es un ancla (`#pedido`, `#pagos`…)
 * a la que apuntan el footer, los mails y la ficha; los textos salen de la
 * configuración real (Configuración → Web y cobros), nunca de números fijos.
 */
export function HowToSection({
  id,
  icon: Icon,
  step,
  title,
  lead,
  children,
  className,
}: {
  id: string;
  icon: LucideIcon;
  /** Número de paso en serif ("1"); sin número para secciones de consulta. */
  step?: number;
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    // max-lg:scroll-mt-36: en celular el índice queda pegado bajo el header (64 px + ≈60 px).
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-24 lg:scroll-mt-28 max-lg:scroll-mt-36", className)}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-200 text-forest-700">
          <Icon className="size-5" aria-hidden />
        </span>
        {step ? (
          <span aria-hidden className="font-apart-serif text-3xl italic text-coral-500">
            {step}
          </span>
        ) : null}
      </div>
      <h2
        id={`${id}-title`}
        className="mt-4 font-apart text-2xl font-extrabold leading-[1.1] tracking-[-0.02em] text-forest-700 text-balance sm:text-[2rem]"
      >
        {title}
      </h2>
      {lead ? <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-700">{lead}</p> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

/** Lista de hechos con ícono chico (qué pasa, qué necesitás). */
export function FactList({
  items,
  className,
}: {
  items: { icon: LucideIcon; title?: string; body: React.ReactNode }[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-4", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-3.5">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-forest-700 ring-1 ring-cream-300">
            <it.icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 pt-1 text-[0.9375rem] leading-relaxed text-ink-700">
            {it.title ? <p className="font-bold text-forest-700">{it.title}</p> : null}
            <div className={cn(it.title && "mt-0.5")}>{it.body}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const REQUEST_FIELDS: { label: string; hint: string; optional?: boolean }[] = [
  { label: "Nombre y apellido", hint: "Para saber a quién esperamos." },
  { label: "Email", hint: "Ahí te llega todo lo de tu reserva." },
  { label: "WhatsApp", hint: "Para coordinar rápido y sin vueltas." },
  { label: "Documento", hint: "Si ya lo tenés a mano.", optional: true },
  { label: "Un mensaje", hint: "Horario de llegada, motivo del viaje, lo que quieras contarnos.", optional: true },
];

export function PedidoSection() {
  return (
    <HowToSection
      id="pedido"
      icon={CalendarHeart}
      step={1}
      title="Pedís tus fechas"
      lead="Elegís el departamento, las fechas y cuántos son. No hace falta crear una cuenta ni cargar una tarjeta: todavía no pagás nada."
    >
      <div className="m-rise rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300 sm:p-7">
        <p className="text-sm font-bold text-forest-700">Qué datos te pedimos</p>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {REQUEST_FIELDS.map((f) => (
            <div key={f.label} className="flex gap-3">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-forest-600" aria-hidden />
              <div>
                <dt className="text-[0.9375rem] font-semibold text-ink-900">
                  {f.label}
                  {f.optional ? <span className="ml-1.5 text-[0.8125rem] font-medium text-ink-500">(opcional)</span> : null}
                </dt>
                <dd className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-500">{f.hint}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
      <FactList
        className="mt-6"
        items={[
          {
            icon: Link2,
            body: "Al enviarlo te damos un link para seguir tu reserva cuando quieras. También te llega por mail.",
          },
          {
            icon: CircleCheck,
            body: "Si tenés cuenta, tus datos se completan solos y la ves en Mis reservas.",
          },
        ]}
      />
    </HowToSection>
  );
}

export function ConfirmacionSection({ responseHours }: { responseHours: number }) {
  return (
    <HowToSection
      id="confirmacion"
      icon={MessageCircleHeart}
      step={2}
      title="Te confirmamos"
      lead={`Revisamos la disponibilidad y te respondemos en menos de ${hoursLabel(responseHours)}, por WhatsApp y mail.`}
    >
      <FactList
        items={[
          {
            icon: CircleCheck,
            title: "Si está disponible",
            body: "Te confirmamos la reserva y te decimos cuánto es la seña y cómo pagarla.",
          },
          {
            icon: Undo2,
            title: "Si no está disponible",
            body: "Te avisamos enseguida. Como no pagaste nada, no hay nada que devolver.",
          },
          {
            icon: Hourglass,
            title: "Si no te respondemos a tiempo",
            body: `El pedido vence solo a las ${REQUEST_EXPIRY_HOURS} horas. No tenés que cancelar nada.`,
          },
          {
            icon: Zap,
            title: "Reserva inmediata",
            body: "Algunos departamentos se confirman al instante, sin esperar respuesta. Los reconocés por la etiqueta «Reserva inmediata».",
          },
        ]}
      />
    </HowToSection>
  );
}

export function PagosSection({ facts }: { facts: ProcessFacts }) {
  if (!facts.senaLabel || !facts.senaDetail) {
    return (
      <HowToSection
        id="pagos"
        icon={WalletCards}
        step={3}
        title="Pagás al llegar"
        lead="No pedimos seña: una vez confirmada tu reserva, pagás la estadía el día que llegás, en efectivo o por transferencia."
      >
        <FactList
          items={[{ icon: ShieldCheck, body: "No cobramos nada online: la web nunca te pide la tarjeta." }]}
        />
      </HowToSection>
    );
  }
  return (
    <HowToSection
      id="pagos"
      icon={WalletCards}
      step={3}
      title="La seña y el resto"
      lead={`Cuando te confirmamos, señás ${facts.senaDetail} para asegurar tus fechas. El resto lo pagás al llegar.`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="m-rise relative overflow-hidden rounded-3xl bg-forest-700 p-6 text-cream shadow-apart-md sm:p-7">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-leaf-300">Al confirmar</p>
          <p className="mt-3 font-apart text-2xl font-extrabold tracking-[-0.02em]">
            Seña de {facts.senaLabel}
          </p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-cream/85">
            Por transferencia. Te pasamos los datos por mail y WhatsApp, y quedan en el link de tu reserva. Tenés{" "}
            {facts.dueLabel} para hacerla.
          </p>
          <span aria-hidden className="absolute -right-6 -top-6 size-20 rounded-full border-[10px] border-coral-500/80" />
        </div>
        <div className="m-rise rounded-3xl bg-paper p-6 shadow-apart-sm ring-1 ring-cream-300 sm:p-7">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">Al llegar</p>
          <p className="mt-3 font-apart text-2xl font-extrabold tracking-[-0.02em] text-forest-700">El resto</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-700">
            El día que te entregamos las llaves, en efectivo o por transferencia.
          </p>
        </div>
      </div>
      <FactList
        className="mt-6"
        items={[
          { icon: ShieldCheck, body: "No cobramos nada online: la web nunca te pide la tarjeta." },
          {
            icon: Send,
            body: "Cuando transfieras, avisanos desde el link de tu reserva (podés adjuntar el comprobante). Cuando lo registramos, tu reserva queda asegurada.",
          },
          {
            icon: Banknote,
            body: "Antes de enviar el pedido ves el total de tu estadía, con la limpieza aparte si corresponde.",
          },
        ]}
      />
    </HowToSection>
  );
}

export function PorMesSection({
  whatsappUrl,
  mailtoUrl = null,
}: {
  whatsappUrl: string | null;
  /** Consulta por mail si no hay WhatsApp configurado. */
  mailtoUrl?: string | null;
}) {
  return (
    <HowToSection
      id="por-mes"
      icon={CalendarRange}
      title="Estadías por mes"
      lead="Para 28 noches o más, la reserva no se pide por la web: se consulta. Escribinos con las fechas y cuántos son, y te pasamos el precio por mes y las condiciones."
    >
      <div className="m-rise rounded-3xl bg-cream-200 p-5 sm:p-7">
        <p className="text-[0.9375rem] leading-relaxed text-ink-700">
          Son departamentos amoblados, pensados para quienes vienen por trabajo, estudio o tratamientos, con
          atención directa del equipo.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {whatsappUrl ? (
            <ApartButton asChild variant="primary" size="lg">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                Consultar por WhatsApp
              </a>
            </ApartButton>
          ) : mailtoUrl ? (
            <ApartButton asChild variant="primary" size="lg">
              <a href={mailtoUrl}>
                <Mail aria-hidden />
                Consultar por mail
              </a>
            </ApartButton>
          ) : null}
          <ApartButton asChild variant="secondary" size="lg">
            <Link href="/buscar?modo=mes">
              Ver estadías por mes
              <ArrowRight aria-hidden />
            </Link>
          </ApartButton>
        </div>
      </div>
    </HowToSection>
  );
}

export function LlegadaSection() {
  return (
    <HowToSection
      id="llegada"
      icon={KeyRound}
      step={4}
      title="La llegada"
      lead="Llegar debe sentirse simple. Por eso lo coordinamos antes, con tiempo."
    >
      <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
        <FactList
          items={[
            {
              icon: CalendarClock,
              body: "Cada departamento tiene su horario de check-in y check-out: lo encontrás en su ficha.",
            },
            {
              icon: MessageCircle,
              body: "Uno o dos días antes te escribimos para coordinar la entrega de las llaves.",
            },
            { icon: MapPin, body: "La dirección exacta te la pasamos con la reserva confirmada." },
            { icon: Banknote, body: "Ese día pagás el saldo, en efectivo o por transferencia. Y listo." },
          ]}
        />
        <figure className="mx-auto w-full max-w-[17rem]">
          <div className="aspect-[4/5] overflow-hidden rounded-t-full rounded-b-3xl bg-cream-300 shadow-apart-md">
            {/* Celular: la foto se mueve más lento que la página dentro del arco. */}
            <div className="m-parallax size-full">
              <BrandPhoto
                name="bienvenida"
                alt="Tarjetas de bienvenida de apart: «Qué lindo tenerte por Córdoba» y «Cuidemos el lugar», junto a un llavero"
                sizes="(min-width: 1024px) 17rem, (min-width: 768px) 15rem, 17rem"
                className="object-[38%_50%]"
              />
            </div>
          </div>
          <figcaption className="mt-3 text-center font-apart-serif text-base italic text-forest-600">
            Este lugar es tuyo por unos días.
          </figcaption>
        </figure>
      </div>
    </HowToSection>
  );
}

const POLICIES = (
  [
    ["flexible", "Flexible"],
    ["moderada", "Moderada"],
    ["estricta", "Estricta"],
  ] as const
).map(([policy, label]) => ({ label, body: cancellationCopy(policy).body }));

export function CancelacionesSection({ customText }: { customText: string | null }) {
  const custom = customText?.trim() || null;
  return (
    <HowToSection
      id="cancelaciones"
      icon={Undo2}
      title="Cancelaciones"
      lead="Mientras tu pedido está pendiente, podés cancelarlo sin costo desde el link de tu reserva. Una vez confirmada, rige la política de cancelación."
    >
      {custom ? (
        <div className="m-rise rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300 sm:p-7">
          <p className="text-sm font-bold text-forest-700">Nuestra política de cancelación</p>
          <p className="mt-2 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-700">{custom}</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-700">
            Cada alojamiento muestra la suya en la ficha, antes de que pidas. Son tres, en palabras simples:
          </p>
          <ul className="grid gap-3 md:grid-cols-3">
            {POLICIES.map((p) => (
              <li key={p.label} className="m-rise rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300">
                <p className="font-bold text-forest-700">{p.label}</p>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-700">{p.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </HowToSection>
  );
}
