import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReservationView } from "@/lib/marketplace/contracts";
import { isActiveStage } from "@/lib/marketplace/guest-stage";
import { todayIsoAR } from "@/lib/marketplace/pricing";
import { cn } from "@/lib/utils";
import { ArcBand, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { StageTimeline } from "@/components/marketplace/brand/process-steps";
import { StatusPill } from "@/components/marketplace/brand/status-pill";
import { CopyLinkButton } from "./copy-link-button";
import { ContactCard, MoneyCard, PolicyCard, StaySummaryCard } from "./reservation-aside";
import { StageMain } from "./stage-main";
import { stageTitleParts } from "./view-helpers";

/** Bienvenida al llegar desde el checkout (`?nuevo=1`). */
function WelcomeBanner({ view }: { view: ReservationView }) {
  const name = view.guest.first_name?.trim();
  return (
    <section
      aria-labelledby="welcome-title"
      className="relative isolate mb-8 overflow-hidden rounded-3xl bg-forest-700 px-5 py-6 text-cream shadow-apart-md max-sm:mb-5 sm:mb-10 sm:px-8 sm:py-8 sm:max-lg:mb-7"
    >
      <ArcBand className="absolute -bottom-3 -right-10 -z-10 w-44 text-coral-500/90 sm:w-64" thickness={16} />
      <p className="font-apart-serif text-lg italic text-leaf-300">Hacemos lugar.</p>
      <h2 id="welcome-title" className="mt-1 max-w-2xl text-2xl font-extrabold leading-tight tracking-[-0.02em] text-balance sm:text-3xl">
        ¡Listo{name ? `, ${name}` : ""}! {view.instant ? "Tu reserva quedó confirmada." : "Nos llegó tu pedido."}
      </h2>
      <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-cream/85">
        Guardá este link: acá vas a ver cada novedad. También te lo mandamos por mail
        {view.guest.email ? (
          <>
            {" "}a <span className="font-semibold text-cream [overflow-wrap:anywhere]">{view.guest.email}</span>
          </>
        ) : null}
        .
      </p>
      {view.status_path ? <CopyLinkButton path={view.status_path} variant="inverse" className="mt-5" /> : null}
    </section>
  );
}

/**
 * La vista de seguimiento de una reserva de la web, compartida por
 * `/reserva/[token]` (sin cuenta) y `/mi-cuenta/reservas/[id]` (con sesión).
 * Todo sale de `ReservationView`: la etapa decide la tarjeta principal y el
 * lateral resume estadía, dinero, contacto y política.
 */
export function ReservationStatusView({
  view,
  isNew = false,
  token = null,
  backHref,
  backLabel = "Mis reservas",
}: {
  view: ReservationView;
  /** Llegó recién del checkout. */
  isNew?: boolean;
  /** Token del link (acciones sin sesión). Sin token, las acciones usan la sesión. */
  token?: string | null;
  backHref?: string;
  backLabel?: string;
}) {
  const now = new Date();
  const todayIso = todayIsoAR();
  const { text, dot } = stageTitleParts(view.copy.title, view.copy.tone);
  const waiting = view.stage === "pedido_enviado" || view.stage === "sena_informada";
  const codeLabel = view.stage.startsWith("pedido_") ? "Pedido" : "Reserva";
  // Celular y tablet, sin repetir: en las etapas activas la tarjeta de la etapa
  // (que va justo abajo) ya dice lo mismo que la bajada, con más detalle; y al
  // llegar del checkout, la bienvenida ya hace de título.
  const bodyInStageCard = isActiveStage(view.stage);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10 lg:px-8">
      {backHref ? (
        <Link
          href={backHref}
          className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-forest-700 outline-none hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      ) : null}

      {isNew ? <WelcomeBanner view={view} /> : null}

      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill tone={view.copy.tone} pulse={waiting}>
            {view.copy.pill}
          </StatusPill>
          <span className="text-sm text-ink-500">
            {codeLabel}{" "}
            <span className="font-mono font-semibold tracking-tight text-forest-700">{view.code}</span>
          </span>
        </div>
        <h1
          className={cn(
            "mt-3 max-w-3xl font-apart text-[2rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.75rem]",
            isNew && "max-lg:sr-only",
          )}
        >
          {text}
          {dot ? <BrandDot /> : null}
        </h1>
        <p
          className={cn(
            "mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-700 text-pretty",
            bodyInStageCard && "max-lg:hidden",
          )}
        >
          {view.copy.body}
        </p>
        <StageTimeline steps={view.timeline} className="mt-7 max-w-xl max-sm:mt-6" />
      </header>

      <div className="mt-8 grid gap-6 max-lg:mt-6 max-sm:gap-5 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:gap-10">
        <div className="min-w-0 space-y-5">
          <StageMain view={view} token={token} now={now} todayIso={todayIso} />
        </div>
        {/* Tablet: el resumen en dos columnas (en una sola quedaba media tarjeta vacía). */}
        <aside
          aria-label="Resumen de tu reserva"
          className="space-y-4 sm:max-lg:grid sm:max-lg:grid-cols-2 sm:max-lg:items-start sm:max-lg:gap-4 sm:max-lg:space-y-0 lg:sticky lg:top-24 lg:self-start"
        >
          <StaySummaryCard view={view} />
          <MoneyCard view={view} />
          <ContactCard view={view} />
          <PolicyCard view={view} />
        </aside>
      </div>
    </div>
  );
}
