import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import type { ReservationView } from "@/lib/marketplace/contracts";
import { isActiveStage } from "@/lib/marketplace/guest-stage";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { guestsLabel, nightsLabel, shortDay } from "./format";
import { MoneyRow, Panel, WhatsAppButton } from "./stage-parts";
import { amountDueOnArrival } from "./view-helpers";

const dtClass = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500";

/** Foto en arco + título + fechas. */
export function StaySummaryCard({ view }: { view: ReservationView }) {
  const { unit, stay } = view;
  return (
    <Panel labelledBy="aside-stay" className="p-4 sm:p-5">
      <div className="flex gap-4">
        <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-b-2xl rounded-t-full bg-cream-200">
          {unit.cover_url ? (
            <Image src={unit.cover_url} alt="" fill sizes="80px" className="object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-forest-700/25">
              <ApartLogo variant="symbol" className="h-8" title={null} />
            </div>
          )}
        </div>
        <div className="min-w-0 pt-1">
          {unit.hood ? <p className="text-[0.8125rem] text-ink-500">{unit.hood}</p> : null}
          <h2 id="aside-stay" className="text-lg font-extrabold leading-tight tracking-[-0.01em] text-forest-700">
            {unit.title}
          </h2>
          {unit.tagline ? (
            <p className="font-apart-serif text-[0.9375rem] italic leading-snug text-forest-600">{unit.tagline}</p>
          ) : null}
          <Link
            href={`/u/${unit.slug}`}
            className="mt-1.5 inline-block text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
          >
            Ver el departamento
          </Link>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-cream-300 pt-4 text-[0.9375rem]">
        <div>
          <dt className={dtClass}>Llegada</dt>
          <dd className="mt-0.5 font-semibold text-ink-900">{shortDay(stay.check_in)}</dd>
        </div>
        <div>
          <dt className={dtClass}>Salida</dt>
          <dd className="mt-0.5 font-semibold text-ink-900">{shortDay(stay.check_out)}</dd>
        </div>
        <div>
          <dt className={dtClass}>Estadía</dt>
          <dd className="mt-0.5 font-semibold text-ink-900">{nightsLabel(stay.nights)}</dd>
        </div>
        <div>
          <dt className={dtClass}>Huéspedes</dt>
          <dd className="mt-0.5 font-semibold text-ink-900">{guestsLabel(stay.guests)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Total, seña, lo cobrado y lo que queda para el día de llegada. */
export function MoneyCard({ view }: { view: ReservationView }) {
  const { money } = view;
  const currency = money.currency || "ARS";
  const live = isActiveStage(view.stage) || view.stage === "estadia_finalizada";
  const waitingConfirmation = view.stage === "pedido_enviado";
  const alLlegar = amountDueOnArrival(money);
  return (
    <Panel labelledBy="aside-money" className="p-4 sm:p-5">
      <h2 id="aside-money" className="text-base font-extrabold text-forest-700">
        {live ? "Cómo se paga" : "Lo que habías pedido"}
      </h2>
      <dl className="mt-3 space-y-2.5 text-[0.9375rem]">
        <MoneyRow label={live ? "Total de la estadía" : "Total cotizado"} value={formatCurrency(money.total, currency)} strong />
        {live ? (
          <>
            <div className="border-t border-dashed border-cream-400 pt-2.5">
              <MoneyRow
                label={waitingConfirmation || money.sena_is_estimate ? "Seña (al confirmar)" : "Seña"}
                hint={money.sena != null && money.sena_covered && money.paid > 0 ? "Recibida" : undefined}
                value={money.sena != null ? formatCurrency(money.sena, currency) : "Sin seña"}
              />
            </div>
            {money.paid > 0 ? <MoneyRow label="Ya pagaste" value={formatCurrency(money.paid, currency)} /> : null}
            <MoneyRow
              label="Al llegar"
              hint="En efectivo o por transferencia"
              value={formatCurrency(alLlegar, currency)}
            />
          </>
        ) : null}
      </dl>
    </Panel>
  );
}

/** El equipo de apart: WhatsApp, mail, el código para mencionar. */
export function ContactCard({ view }: { view: ReservationView }) {
  const { contact } = view;
  return (
    <Panel labelledBy="aside-contact" className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-b-lg rounded-t-full bg-forest-700 text-cream">
          <ApartLogo variant="symbol" className="h-5" title={null} />
        </span>
        <div className="min-w-0">
          <h2 id="aside-contact" className="font-extrabold leading-tight text-forest-700">
            Te acompaña el equipo de apart
          </h2>
          <p className="text-[0.8125rem] text-ink-500">Respondemos en menos de {hoursLabel(view.response_hours)}.</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-700">
        Si nos escribís, mencioná tu código{" "}
        <strong className="font-mono font-semibold tracking-tight text-forest-700">{view.code}</strong>.
      </p>
      <div className="mt-4 grid gap-2">
        {contact.whatsapp_url ? (
          <WhatsAppButton href={contact.whatsapp_url} variant="soft" size="md" className="w-full">
            Escribinos por WhatsApp
          </WhatsAppButton>
        ) : null}
        {contact.email ? (
          <ApartButton asChild variant="secondary" size="md" className="w-full">
            <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`Mi reserva ${view.code}`)}`}>
              <Mail aria-hidden />
              Escribinos por mail
            </a>
          </ApartButton>
        ) : null}
        {contact.instagram ? (
          <a
            href={`https://instagram.com/${contact.instagram}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-auto mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
          >
            @{contact.instagram} en Instagram
          </a>
        ) : null}
      </div>
    </Panel>
  );
}

/** Política de cancelación de la etapa (no se dibuja cuando ya no hay nada que cancelar). */
export function PolicyCard({ view }: { view: ReservationView }) {
  if (!view.cancellation) return null;
  return (
    <section aria-labelledby="aside-policy" className="rounded-3xl bg-cream-200/60 px-4 py-4 ring-1 ring-cream-300 sm:px-5">
      <h2 id="aside-policy" className="text-sm font-bold text-forest-700">
        {view.cancellation.title}
      </h2>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-700">{view.cancellation.body}</p>
    </section>
  );
}
