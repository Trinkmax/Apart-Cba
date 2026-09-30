import Link from "next/link";
import { CalendarCheck2, DoorOpen, KeyRound, MapPin, Search, WalletCards } from "lucide-react";
import type { ReservationPaymentReport, ReservationView } from "@/lib/marketplace/contracts";
import type { PaymentReportStatus } from "@/lib/types/database";
import type { StageTone } from "@/lib/marketplace/guest-stage";
import { formatPhoneAR } from "@/lib/marketplace/display";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { senaRemaining } from "@/lib/marketplace/sena";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { StatusPill } from "@/components/marketplace/brand/status-pill";
import { TimeUntil } from "@/components/marketplace/time-until";
import { AddToCalendarButton } from "./add-to-calendar-button";
import { CancelRequestDialog } from "./cancel-request-dialog";
import { atPhrase, beforePhrase, eventLabel, longDay } from "./format";
import { ReportPaymentForm } from "./report-payment-form";
import { SenaPaymentCard } from "./sena-card";
import { ContactButton, InfoRow, Panel, PanelTitle } from "./stage-parts";
import { amountDueOnArrival, mapsUrl, responseDeadline, stayQuery } from "./view-helpers";

export interface StageMainProps {
  view: ReservationView;
  /** Link del seguimiento: las acciones sin sesión viajan con él. */
  token?: string | null;
  now: Date;
  todayIso: string;
}

/** Con qué se identifica el huésped en las acciones (link o sesión). */
function actionRef(view: ReservationView, token?: string | null) {
  return token ? { token, requestId: null } : { token: null, requestId: view.request_id ?? view.booking_id };
}

const REPORT_STATUS: Record<PaymentReportStatus, { label: string; tone: StageTone }> = {
  pendiente: { label: "En revisión", tone: "info" },
  registrado: { label: "Acreditada", tone: "ok" },
  descartado: { label: "No la encontramos", tone: "muted" },
};

function ReportsList({ reports, currency }: { reports: ReservationPaymentReport[]; currency: string }) {
  if (reports.length === 0) return null;
  return (
    <ul className="divide-y divide-cream-300 overflow-hidden rounded-2xl bg-cream-200/50 ring-1 ring-cream-300">
      {reports.map((r) => {
        const st = REPORT_STATUS[r.status] ?? REPORT_STATUS.pendiente;
        return (
          <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold tabular-nums text-ink-900">
                {r.amount != null ? formatCurrency(r.amount, currency) : "Transferencia"}
              </p>
              <p className="text-[0.8125rem] text-ink-500">
                Aviso del {eventLabel(r.created_at)}
                {r.has_receipt ? " · con comprobante" : ""}
              </p>
            </div>
            <StatusPill tone={st.tone} className="shrink-0">
              {st.label}
            </StatusPill>
          </li>
        );
      })}
    </ul>
  );
}

/** Pedido enviado: cuándo respondemos, que no se paga nada, y poder cancelar. */
function PedidoEnviado({ view, token, now }: StageMainProps) {
  const ref = actionRef(view, token);
  const phone = formatPhoneAR(view.guest.phone);
  const { sena, currency } = view.money;
  // La promesa es la de toda la web: responder en `response_hours` desde el
  // pedido. `expires_at` (48 h) es cuándo el pedido vence solo si nadie lo
  // mira: sólo se nombra si ya nos pasamos de la promesa.
  const promise = responseDeadline(view.created_at, view.response_hours, view.expires_at);
  const late = promise != null && Date.parse(promise) <= now.getTime();
  const expiresLater = view.expires_at && Date.parse(view.expires_at) > now.getTime() ? view.expires_at : null;
  return (
    <Panel labelledBy="stage-title">
      <Eyebrow>Qué pasa ahora</Eyebrow>
      <PanelTitle id="stage-title" className="mt-2">
        {late
          ? "Estamos por responderte"
          : promise
            ? `Te respondemos ${beforePhrase(promise, now)}`
            : `Te respondemos en menos de ${hoursLabel(view.response_hours)}`}
      </PanelTitle>
      {promise && !late ? (
        <TimeUntil
          isoDeadline={promise}
          variant="friendly"
          expiredLabel="Ya casi"
          className="mt-2 inline-flex rounded-full bg-leaf-100 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-forest-700"
        />
      ) : null}
      {late ? (
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-700">
          Nos está llevando más de lo que prometimos, perdón.
          {expiresLater
            ? ` Si no llegamos a tiempo, el pedido vence solo ${atPhrase(expiresLater, now)} y no tenés que hacer nada.`
            : null}
        </p>
      ) : null}
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-700">
        Revisamos la disponibilidad y te escribimos por WhatsApp{phone ? ` al ${phone}` : ""} y por mail a{" "}
        <span className="font-semibold text-ink-900 [overflow-wrap:anywhere]">{view.guest.email}</span>.
      </p>
      <div className="mt-5 rounded-2xl bg-leaf-100 px-4 py-4 ring-1 ring-leaf-300">
        <p className="font-bold text-forest-700">Todavía no pagás nada.</p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-forest-800">
          {sena
            ? `Cuando te confirmemos, te pasamos los datos para transferir la seña de ${formatCurrency(sena, currency)}. El resto lo pagás al llegar.`
            : "Cuando te confirmemos, te contamos cómo seguir. El pago es al llegar."}
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <ContactButton
          contact={view.contact}
          subject={`Mi pedido ${view.code}`}
          whatsappLabel="Escribinos"
          variant="primary"
          className="w-full sm:w-auto"
        />
        {view.can_cancel ? (
          <CancelRequestDialog token={ref.token} requestId={ref.requestId} className="w-full sm:w-auto" />
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Los avisos de pago que ya mandó el huésped mientras todavía falta seña: uno
 * que el equipo no encontró ("descartado") o una parte ya acreditada. Sin esto,
 * un aviso descartado desaparecía sin explicación.
 */
function ReportsHistory({ view, now }: { view: ReservationView; now: Date }) {
  const reports = view.payment_reports;
  if (reports.length === 0) return null;
  const latest = reports[0];
  return (
    <Panel labelledBy="reports-title">
      <h2 id="reports-title" className="text-base font-extrabold tracking-[-0.01em] text-forest-700 sm:text-lg">
        Tus avisos de pago
      </h2>
      {latest.status === "descartado" ? (
        <div className="mt-3 rounded-2xl bg-coral-50 px-4 py-3.5 ring-1 ring-coral-200">
          <p className="text-[0.9375rem] leading-relaxed text-ink-900">
            No encontramos la transferencia que nos avisaste {atPhrase(latest.created_at, now)}. Revisá el comprobante
            o escribinos y lo vemos juntos.
          </p>
          <ContactButton
            contact={view.contact}
            subject={`Seña de mi reserva ${view.code}`}
            variant="secondary"
            size="md"
            className="mt-3 w-full sm:w-auto"
          />
        </div>
      ) : null}
      <div className="mt-4">
        <ReportsList reports={reports} currency={view.money.currency} />
      </div>
    </Panel>
  );
}

/** Confirmada, falta la seña: la tarjeta de pago y el aviso de transferencia. */
function SenaPendiente({ view, token, now }: StageMainProps) {
  const ref = actionRef(view, token);
  const { sena, paid, currency } = view.money;
  // Con una parte ya cobrada, el formulario propone lo que falta, no la seña entera.
  const falta = senaRemaining(sena, paid);
  const partial = sena != null && paid > 0 && falta > 0;
  return (
    <>
      <SenaPaymentCard view={view} now={now} />
      <ReportsHistory view={view} now={now} />
      {view.can_report_payment ? (
        <ReportPaymentForm
          token={ref.token}
          requestId={ref.requestId}
          sena={partial ? falta : sena}
          currency={currency}
          amountHint={
            partial && sena != null
              ? `Te falta transferir ${formatCurrency(falta, currency)} de la seña de ${formatCurrency(sena, currency)}.`
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/** El huésped avisó que transfirió: estamos verificando. */
function SenaInformada({ view, token, now }: StageMainProps) {
  const ref = actionRef(view, token);
  const { sena, paid, currency } = view.money;
  // "Otra transferencia": el monto no se adivina. Si ya hay una parte cobrada
  // se propone lo que falta; si no, el campo arranca vacío (proponer la seña
  // entera invitaba a avisar dos veces la misma transferencia).
  const falta = senaRemaining(sena, paid);
  const otherAmount = paid > 0 && falta > 0 ? falta : null;
  return (
    <>
      <Panel labelledBy="stage-title">
        <Eyebrow>Tu seña</Eyebrow>
        <PanelTitle id="stage-title" className="mt-2">
          Estamos verificando tu transferencia
        </PanelTitle>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-700">
          Apenas la veamos acreditada te avisamos por WhatsApp y por mail. No hace falta que hagas nada más.
        </p>
        <div className="mt-5">
          <ReportsList reports={view.payment_reports} currency={view.money.currency} />
        </div>
      </Panel>
      <details className="group rounded-3xl bg-paper ring-1 ring-cream-300 open:shadow-apart-sm">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-3 font-semibold text-forest-700 outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/30 sm:px-7 [&::-webkit-details-marker]:hidden">
          Ver los datos para transferir
          <span aria-hidden className="text-xl leading-none transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="px-2 pb-2 sm:px-3 sm:pb-3">
          <SenaPaymentCard view={view} now={now} compact />
        </div>
      </details>
      {view.can_report_payment ? (
        <ReportPaymentForm
          token={ref.token}
          requestId={ref.requestId}
          sena={otherAmount}
          currency={currency}
          amountHint={sena != null ? `La seña es de ${formatCurrency(sena, currency)}.` : undefined}
          title="¿Hiciste otra transferencia?"
          intro="Si mandaste otra parte de la seña o te equivocaste de monto, avisanos acá."
          triggerLabel="Avisar otra transferencia"
          triggerVariant="secondary"
        />
      ) : null}
    </>
  );
}

/** Reserva asegurada: dirección, llegada, lo que se paga al llegar y el calendario. */
function ReservaAsegurada({ view }: StageMainProps) {
  const alLlegar = amountDueOnArrival(view.money);
  const location = view.unit.address ? `${view.unit.address}${view.unit.hood ? `, ${view.unit.hood}` : ""}, Córdoba` : null;
  const description = [
    `Tu estadía en ${view.unit.title} (apart).`,
    view.unit.check_in_window ? `Check-in ${view.unit.check_in_window}.` : null,
    alLlegar > 0 ? `Al llegar pagás ${formatCurrency(alLlegar, view.money.currency)}.` : null,
    `Código ${view.code}.`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Panel labelledBy="stage-title">
      <Eyebrow>Tu llegada</Eyebrow>
      <PanelTitle id="stage-title" className="mt-2">
        Este lugar es tuyo por unos días
      </PanelTitle>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {view.unit.address ? (
          <InfoRow icon={MapPin} label="Dirección" className="sm:col-span-2">
            {view.unit.address}
            {view.unit.hood ? <span className="font-normal text-ink-500"> · {view.unit.hood}</span> : null}
            <a
              href={mapsUrl(view.unit.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block w-fit text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
            >
              Ver en el mapa<span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </InfoRow>
        ) : null}
        <InfoRow icon={KeyRound} label="Llegada">
          {longDay(view.stay.check_in)}
          {view.unit.check_in_window ? (
            <span className="block font-normal text-ink-500">Check-in {view.unit.check_in_window}</span>
          ) : null}
        </InfoRow>
        <InfoRow icon={DoorOpen} label="Salida">
          {longDay(view.stay.check_out)}
        </InfoRow>
        <InfoRow icon={WalletCards} label="Al llegar pagás" className="sm:col-span-2">
          {alLlegar > 0 ? (
            <>
              <span className="text-lg font-extrabold tabular-nums text-forest-700">
                {formatCurrency(alLlegar, view.money.currency)}
              </span>
              <span className="block font-normal text-ink-500">En efectivo o por transferencia, cuando te entregamos las llaves.</span>
            </>
          ) : (
            "Nada más: ya está todo pago."
          )}
        </InfoRow>
      </div>
      <p className="mt-6 flex gap-3 rounded-2xl bg-leaf-100 px-4 py-4 text-[0.9375rem] leading-relaxed text-forest-800 ring-1 ring-leaf-300">
        <CalendarCheck2 className="mt-0.5 size-5 shrink-0 text-forest-700" aria-hidden />
        Uno o dos días antes de tu llegada te escribimos por WhatsApp para coordinar la entrega de llaves.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <AddToCalendarButton
          uid={view.request_id ?? view.booking_id ?? view.code}
          code={view.code}
          title={`Estadía en ${view.unit.title} · apart`}
          checkIn={view.stay.check_in}
          checkOut={view.stay.check_out}
          location={location}
          description={description}
          path={view.status_path}
          className="w-full sm:w-auto"
        />
        <ContactButton
          contact={view.contact}
          subject={`Mi reserva ${view.code}`}
          whatsappLabel="Escribinos"
          className="w-full sm:w-auto"
        />
      </div>
    </Panel>
  );
}

/** Durante la estadía: dirección, salida y contacto a mano. */
function EstadiaEnCurso({ view }: StageMainProps) {
  return (
    <Panel labelledBy="stage-title">
      <Eyebrow>Tu estadía</Eyebrow>
      <PanelTitle id="stage-title" className="mt-2">
        Sentite como en casa
      </PanelTitle>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {view.unit.address ? (
          <InfoRow icon={MapPin} label="Dirección">
            {view.unit.address}
          </InfoRow>
        ) : null}
        <InfoRow icon={DoorOpen} label="Salida">
          {longDay(view.stay.check_out)}
        </InfoRow>
      </div>
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-700">
        Si necesitás algo durante tu estadía, escribinos. Estamos para ayudarte.
      </p>
      <ContactButton
        contact={view.contact}
        subject={`Mi estadía ${view.code}`}
        variant="primary"
        className="mt-4 w-full sm:w-auto"
      />
    </Panel>
  );
}

/** Después de la salida: gracias y volver a buscar. */
function EstadiaFinalizada({ view }: StageMainProps) {
  return (
    <Panel labelledBy="stage-title">
      <PanelTitle id="stage-title">Explorar. Disfrutar. Repetir.</PanelTitle>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-700">
        Gracias por elegirnos. Cuando vuelvas a Córdoba, acá vamos a estar.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <ApartButton asChild variant="primary" size="lg" className="w-full sm:w-auto">
          <Link href={`/u/${view.unit.slug}`}>Volver a {view.unit.title}</Link>
        </ApartButton>
        <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
          <Link href="/buscar">
            <Search aria-hidden />
            Buscar otro lugar
          </Link>
        </ApartButton>
      </div>
    </Panel>
  );
}

/** Pedido vencido, rechazado o cancelado, o reserva anulada: qué hacer ahora. */
function Cerrada({ view, todayIso }: StageMainProps) {
  const q = stayQuery(view, todayIso);
  const sameUnit = `/u/${view.unit.slug}${q}`;
  const others = `/buscar${q}`;
  const futureDates = view.stay.check_in >= todayIso;

  let primary: { href: string; label: string };
  let secondary: { href: string; label: string } | null;
  switch (view.stage) {
    case "pedido_rechazado":
      primary = { href: others, label: futureDates ? "Ver otros lugares para esas fechas" : "Buscar otro lugar" };
      secondary = null;
      break;
    case "pedido_vencido":
      primary = { href: sameUnit, label: futureDates ? "Volver a pedir estas fechas" : `Volver a ${view.unit.title}` };
      secondary = { href: others, label: "Ver otros lugares" };
      break;
    case "pedido_cancelado":
      primary = { href: sameUnit, label: "Armar un pedido nuevo" };
      secondary = { href: others, label: "Ver otros lugares" };
      break;
    default:
      primary = { href: others, label: "Buscar otras fechas" };
      secondary = null;
  }

  return (
    <Panel labelledBy="stage-title">
      <PanelTitle id="stage-title">¿Seguimos buscando?</PanelTitle>
      {view.stage === "pedido_rechazado" && view.rejection_reason ? (
        <div className="mt-3 rounded-2xl bg-cream-200/70 px-4 py-3.5 ring-1 ring-cream-300">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">Nuestro mensaje</p>
          <p className="mt-1 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-900">{view.rejection_reason}</p>
        </div>
      ) : null}
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-700">
        Hay lugares que conectan personas. Si nos contás qué necesitás, te ayudamos a encontrar el tuyo.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <ApartButton asChild variant="primary" size="lg" className="w-full sm:w-auto">
          <Link href={primary.href}>{primary.label}</Link>
        </ApartButton>
        {secondary ? (
          <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
            <Link href={secondary.href}>{secondary.label}</Link>
          </ApartButton>
        ) : null}
        <ContactButton
          contact={view.contact}
          subject={`Mi pedido ${view.code}`}
          whatsappLabel="Escribinos"
          className="w-full sm:w-auto"
        />
      </div>
    </Panel>
  );
}

/** La tarjeta principal del seguimiento según la etapa del huésped. */
export function StageMain(props: StageMainProps) {
  switch (props.view.stage) {
    case "pedido_enviado":
      return <PedidoEnviado {...props} />;
    case "sena_pendiente":
      return <SenaPendiente {...props} />;
    case "sena_informada":
      return <SenaInformada {...props} />;
    case "reserva_asegurada":
      return <ReservaAsegurada {...props} />;
    case "estadia_en_curso":
      return <EstadiaEnCurso {...props} />;
    case "estadia_finalizada":
      return <EstadiaFinalizada {...props} />;
    default:
      return <Cerrada {...props} />;
  }
}
