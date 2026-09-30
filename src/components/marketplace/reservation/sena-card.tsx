import { Clock } from "lucide-react";
import type { ReservationView } from "@/lib/marketplace/contracts";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { senaRemaining } from "@/lib/marketplace/sena";
import { ArcBand, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { TimeUntil } from "@/components/marketplace/time-until";
import { CopyRow } from "./copy-row";
import { amountCopyValue, atPhrase, beforePhrase } from "./format";
import { ContactButton } from "./stage-parts";
import { amountDueOnArrival, groupCbu } from "./view-helpers";

/**
 * La tarjeta donde el huésped paga: monto grande de la seña, hasta cuándo, y
 * los datos para transferir con copiar de un toque. Pensada primero para el
 * celular (es donde se abre el home banking).
 */
export function SenaPaymentCard({
  view,
  now,
  compact = false,
}: {
  view: ReservationView;
  now: Date;
  /** Etapa "verificando": los datos quedan como referencia, sin el bloque grande. */
  compact?: boolean;
}) {
  const { money, transfer, contact } = view;
  const sena = money.sena ?? 0;
  const currency = money.currency || "ARS";
  const dueAt = money.sena_due_at;
  const overdue = dueAt ? Date.parse(dueAt) <= now.getTime() : false;
  const alLlegar = amountDueOnArrival(money);
  // Si el equipo ya registró una parte, se pide SÓLO lo que falta: mostrar la
  // seña entera al lado de "Ya pagaste" invitaba a transferirla dos veces.
  const falta = senaRemaining(sena, money.paid);
  const partial = money.paid > 0 && falta > 0 && falta < sena;
  const toTransfer = partial ? falta : sena;

  return (
    <section
      aria-labelledby="sena-title"
      className="overflow-hidden rounded-3xl bg-paper shadow-apart-lg ring-1 ring-cream-300"
    >
      {!compact ? (
        <div className="relative isolate overflow-hidden bg-forest-700 px-5 pb-6 pt-6 text-cream sm:px-7 sm:pb-7 sm:pt-7">
          <ArcBand className="absolute -right-12 -top-4 -z-10 w-44 text-coral-500/85 sm:w-56" thickness={16} />
          <Eyebrow className="text-leaf-300">Asegurá tu reserva</Eyebrow>
          <h2 id="sena-title" className="mt-3 text-[0.9375rem] font-semibold text-cream/85">
            {partial ? "Te falta transferir" : "Seña a transferir"}
          </h2>
          {/* clamp: "$ 1.250.000" entra en un celular de 360 px sin desbordar. */}
          <p className="mt-1 text-[clamp(2.25rem,11vw,2.75rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums sm:text-[3.5rem]">
            {formatCurrency(toTransfer, currency)}
          </p>
          {partial ? (
            <p className="mt-2 text-[0.9375rem] leading-snug text-cream/85 tabular-nums">
              Seña {formatCurrency(sena, currency)} · ya recibimos {formatCurrency(money.paid, currency)}
            </p>
          ) : null}
          {dueAt ? (
            overdue ? (
              <p className="mt-4 rounded-2xl bg-cream/10 px-3.5 py-2.5 text-[0.9375rem] leading-snug text-cream">
                El plazo venció {atPhrase(dueAt, now)}. Si todavía no transferiste, escribinos y vemos cómo
                seguimos.
              </p>
            ) : (
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.9375rem] leading-snug">
                <Clock className="size-4 shrink-0 text-leaf-300" aria-hidden />
                <span>
                  Transferí <strong className="font-bold">{beforePhrase(dueAt, now)}</strong>
                </span>
                <TimeUntil
                  isoDeadline={dueAt}
                  variant="friendly"
                  expiredLabel="plazo vencido"
                  className="rounded-full bg-cream/15 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-cream"
                />
              </p>
            )
          ) : null}
          <p className="mt-3 text-[0.9375rem] leading-snug text-cream/80">
            {alLlegar > 0 ? (
              <>
                El resto, <span className="font-semibold text-cream tabular-nums">{formatCurrency(alLlegar, currency)}</span>, lo
                pagás al llegar.
              </>
            ) : (
              "Con la seña queda todo pago."
            )}
          </p>
        </div>
      ) : null}

      <div className="space-y-4 px-5 py-6 sm:px-7">
        <h3
          id={compact ? "sena-title" : undefined}
          className="text-base font-extrabold tracking-[-0.01em] text-forest-700 sm:text-lg"
        >
          Datos para transferir
        </h3>
        {transfer ? (
          <div className="grid gap-2">
            <CopyRow
              label="Monto exacto"
              value={amountCopyValue(toTransfer)}
              display={formatCurrency(toTransfer, currency)}
              emphasis
            />
            {transfer.alias ? <CopyRow label="Alias" value={transfer.alias} mono /> : null}
            {transfer.cbu ? (
              <CopyRow label="CBU" value={transfer.cbu.replace(/\D+/g, "")} display={groupCbu(transfer.cbu)} mono />
            ) : null}
            {transfer.cuit ? <CopyRow label="CUIT" value={transfer.cuit.replace(/\D+/g, "")} display={transfer.cuit} mono /> : null}
            {transfer.holder || transfer.bank ? (
              <dl className="grid gap-2 rounded-2xl bg-cream-200/60 px-4 py-3 text-[0.9375rem] sm:grid-cols-2">
                {transfer.holder ? (
                  <div>
                    <dt className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">Titular</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">{transfer.holder}</dd>
                  </div>
                ) : null}
                {transfer.bank ? (
                  <div>
                    <dt className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">Banco</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">{transfer.bank}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {transfer.notes ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{transfer.notes}</p>
            ) : null}
          </div>
        ) : (
          // Sin datos de transferencia cargados en Configuración → Web y cobros:
          // el texto nombra el canal que de verdad hay (WhatsApp, mail o, sin
          // ninguno, el mail del propio huésped) y el botón coincide con él.
          <div className="rounded-2xl bg-leaf-100 px-4 py-4 ring-1 ring-leaf-300">
            <p className="font-semibold text-forest-700">
              {contact.whatsapp_url
                ? "Te pasamos los datos por WhatsApp."
                : contact.email
                  ? "Te pasamos los datos por mail."
                  : "Te mandamos los datos por mail."}
            </p>
            <p className="mt-1 text-[0.9375rem] leading-relaxed text-forest-800">
              {contact.whatsapp_url || contact.email ? (
                <>
                  Escribinos y te mandamos el alias o CBU para transferir{" "}
                  {partial ? "lo que falta de la seña" : "la seña"}, {formatCurrency(toTransfer, currency)}.
                </>
              ) : (
                <>
                  Te escribimos a{" "}
                  <span className="font-semibold [overflow-wrap:anywhere]">{view.guest.email}</span> con el alias o
                  CBU para transferir {formatCurrency(toTransfer, currency)}.
                </>
              )}
            </p>
            <ContactButton
              contact={contact}
              subject={`Seña de mi reserva ${view.code}`}
              whatsappLabel="Pedir los datos por WhatsApp"
              mailLabel="Pedir los datos por mail"
              variant="primary"
              className="mt-3 w-full sm:w-auto"
            />
          </div>
        )}
        {!compact ? (
          <ol className="grid gap-2.5 border-t border-cream-300 pt-4 text-[0.9375rem] leading-snug text-ink-700">
            {[
              `Transferí ${formatCurrency(toTransfer, currency)} desde tu banco o billetera.`,
              "Avisanos acá abajo, con el comprobante si lo tenés.",
              "Lo verificamos y te confirmamos por WhatsApp y mail. Listo.",
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="w-5 shrink-0 text-right font-apart-serif text-lg italic leading-none text-coral-600">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
