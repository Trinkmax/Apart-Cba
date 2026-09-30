import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  ChevronLeft,
  Mail,
  MessageCircle,
  Users,
} from "lucide-react";
import { getApprovalDefaults, getBookingRequest } from "@/lib/actions/booking-requests";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { BookingRequestActions } from "@/components/bookings/booking-request-actions";
import { PaymentReportsCard } from "@/components/bookings/payment-reports-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { restoAlLlegar } from "@/lib/marketplace/sena";
import { formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { dateTimeLabel, shortDayLabel, stayRangeLabel } from "@/lib/marketplace/staff-helpers";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { ExpiryLabel } from "../_components/expiry-label";
import { REQUEST_STATUS_META, unitTitleOf } from "../_components/web-request-card";

type Params = Promise<{ id: string }>;

const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com" };

export default async function BookingRequestDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const [request, defaults, { role }] = await Promise.all([
    getBookingRequest(id),
    getApprovalDefaults(id),
    getCurrentOrg(),
  ]);
  if (!request) notFound();

  const canViewMoney = can(role, "payments", "view");
  const canApprove = can(role, "bookings", "create");
  const canReject = can(role, "bookings", "update");
  const isPending = request.status === "pendiente";
  const status = REQUEST_STATUS_META[request.status] ?? REQUEST_STATUS_META.pendiente;
  const title = unitTitleOf(request);
  const total = Number(request.total_amount);
  const cleaning = request.cleaning_fee != null ? Number(request.cleaning_fee) : 0;
  const estimate = request.deposit_estimate != null ? Number(request.deposit_estimate) : null;
  const wa = whatsappLink(request.guest_phone);
  const code = `AP-${request.id.slice(0, 6).toUpperCase()}`;
  const conflicts = defaults?.conflicts ?? [];
  const requestConflicts = defaults?.requestConflicts ?? [];
  // Una sola lectura del reloj por request: la etiqueta de vencimiento arranca de acá.
  const serverNow = new Date().getTime();

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-5">
      <LiveRefresh tables={["booking_requests", "bookings"]} label="cambio" labelPlural="cambios" />
      <Link
        href="/dashboard/reservas-pendientes"
        className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> Solicitudes
      </Link>

      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Pedido de {request.guest_full_name}</h1>
          <Badge className={status.cls}>{status.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {code} · recibido {dateTimeLabel(request.created_at)}
        </p>
      </header>

      {isPending ? (
        <Card className="flex flex-col gap-2 border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30">
          <div className="space-y-0.5 text-sm">
            <ExpiryLabel expiresAt={request.expires_at} serverNow={serverNow} className="text-sm" />
            <p className="text-muted-foreground">
              Si no respondés antes, el pedido vence solo y le avisamos al huésped que busque otras fechas.
            </p>
          </div>
          <BookingRequestActions
            canApprove={canApprove}
            canReject={canReject}
            defaults={defaults}
            request={{
              id: request.id,
              total,
              currency: request.currency,
              guestName: request.guest_full_name,
              guestPhone: request.guest_phone,
              unitTitle: title,
              checkIn: request.check_in_date,
              checkOut: request.check_out_date,
              nights: request.nights,
              guests: request.guests_count,
            }}
          />
        </Card>
      ) : null}

      {request.status === "aprobada" ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 text-sm">
            <CalendarCheck className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            Confirmada {request.approved_at ? dateTimeLabel(request.approved_at) : ""}. Ya es una reserva.
          </p>
          {request.resulting_booking_id ? (
            <Link
              href={`/dashboard/reservas/${request.resulting_booking_id}`}
              className="inline-flex min-h-9 items-center gap-1 text-sm font-medium hover:underline underline-offset-2"
            >
              Ver reserva <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Unidad</h2>
              <Link
                href={`/dashboard/unidades/${request.unit?.id ?? request.unit_id}`}
                className="mt-1 inline-block text-base font-medium hover:underline underline-offset-2"
              >
                {title}
              </Link>
              {request.unit?.code ? <p className="text-sm text-muted-foreground">Código {request.unit.code}</p> : null}
            </div>
            <div className="border-t pt-4">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Estadía</h2>
              <p className="mt-1 font-medium">{stayRangeLabel(request.check_in_date, request.check_out_date, request.nights)}</p>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Llega</dt>
                  <dd>
                    {shortDayLabel(request.check_in_date)} · desde las {request.check_in_time.slice(0, 5)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Se va</dt>
                  <dd>
                    {shortDayLabel(request.check_out_date)} · hasta las {request.check_out_time.slice(0, 5)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Huéspedes</dt>
                  <dd className="inline-flex items-center gap-1">
                    <Users className="size-3.5 text-muted-foreground" aria-hidden />
                    {request.guests_count}
                  </dd>
                </div>
              </dl>
            </div>
            {request.special_requests ? (
              <div className="border-t pt-4">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Mensaje del huésped</h2>
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{request.special_requests}</p>
              </div>
            ) : null}
            {request.rejection_reason ? (
              <div className="border-t pt-4">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Motivo del rechazo</h2>
                <p className="mt-2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                  {request.rejection_reason}
                </p>
              </div>
            ) : null}
          </Card>

          {isPending && defaults ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Chequeo de ocupación</h2>
              {conflicts.length === 0 && requestConflicts.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <CalendarCheck className="size-4" aria-hidden />
                  Las fechas están libres en el calendario de la unidad.
                </p>
              ) : null}
              {conflicts.length > 0 ? (
                <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                    Esas fechas ya están ocupadas: confirmar va a fallar hasta que lo resuelvas.
                  </p>
                  <ul className="space-y-1">
                    {conflicts.map((c) => (
                      <li key={c.booking_id}>
                        <Link href={`/dashboard/reservas/${c.booking_id}`} className="font-medium hover:underline underline-offset-2">
                          {c.is_block ? "Bloqueo" : (c.guest_name ?? "Reserva")}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}· {shortDayLabel(c.check_in)} → {shortDayLabel(c.check_out)}
                          {c.source ? ` · ${c.source}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {requestConflicts.length > 0 ? (
                <div className="space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-medium">Solicitudes de otros canales sin confirmar en esas fechas</p>
                  <ul className="space-y-0.5">
                    {requestConflicts.map((c) => (
                      <li key={c.id}>
                        {CHANNEL_LABEL[c.channel] ?? c.channel}
                        {c.guest_name ? ` · ${c.guest_name}` : ""} · {shortDayLabel(c.check_in)} → {shortDayLabel(c.check_out)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs">No ocupan el calendario, pero si la OTA las acepta vas a tener una venta doble.</p>
                </div>
              ) : null}
            </Card>
          ) : null}

          {canViewMoney && defaults?.nightly && defaults.nightly.nights.length > 0 ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Desglose por noche</h2>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
                {defaults.nightly.nights.map((n) => (
                  <li key={n.date} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span>
                      {shortDayLabel(n.date)}
                      {n.rule_name ? <span className="ml-2 text-xs text-muted-foreground">{n.rule_name}</span> : null}
                    </span>
                    <span className="tabular-nums">{formatMoney(n.price, request.currency)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Alojamiento</dt>
                  <dd className="tabular-nums">{formatMoney(defaults.nightly.subtotal, request.currency)}</dd>
                </div>
                {defaults.nightly.cleaning_fee > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Limpieza</dt>
                    <dd className="tabular-nums">{formatMoney(defaults.nightly.cleaning_fee, request.currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between font-medium">
                  <dt>Total con las tarifas de hoy</dt>
                  <dd className="tabular-nums">{formatMoney(defaults.nightly.total, request.currency)}</dd>
                </div>
              </dl>
              {defaults.nightly.differs ? (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Las tarifas cambiaron desde que llegó el pedido. Al confirmar se respeta el total que vio el huésped (
                  {formatMoney(total, request.currency)}).
                </p>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="h-fit space-y-4 p-5">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Huésped</h2>
              <p className="mt-1 text-base font-medium">{request.guest_full_name}</p>
              <div className="mt-2 space-y-1 text-sm">
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-9 items-center gap-1.5 text-emerald-700 hover:underline underline-offset-2 dark:text-emerald-400"
                  >
                    <MessageCircle className="size-4" aria-hidden /> {formatPhoneAR(request.guest_phone) ?? request.guest_phone}
                  </a>
                ) : request.guest_phone ? (
                  <p className="text-muted-foreground">{request.guest_phone}</p>
                ) : null}
                <a
                  href={`mailto:${request.guest_email}`}
                  className="flex min-h-9 items-center gap-1.5 break-all hover:underline underline-offset-2"
                >
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {request.guest_email}
                </a>
                {request.guest_document ? (
                  <p className="text-xs text-muted-foreground">Documento: {request.guest_document}</p>
                ) : null}
              </div>
            </div>

            {canViewMoney ? (
              <div className="space-y-1.5 border-t pt-4 text-sm">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Importes del pedido</h2>
                <p className="text-2xl font-semibold tabular-nums">{formatMoney(total, request.currency)}</p>
                {cleaning > 0 ? (
                  <p className="text-xs text-muted-foreground">Incluye {formatMoney(cleaning, request.currency)} de limpieza.</p>
                ) : null}
                {estimate != null && estimate > 0 ? (
                  <dl className="space-y-1 pt-2">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Seña estimada</dt>
                      <dd className="tabular-nums">{formatMoney(estimate, request.currency)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Al llegar</dt>
                      <dd className="tabular-nums">{formatMoney(restoAlLlegar(total, estimate), request.currency)}</dd>
                    </div>
                  </dl>
                ) : null}
                <p className="pt-1 text-xs text-muted-foreground">
                  La seña final la elegís al confirmar. Nada de esto entra a Caja hasta que registres el cobro.
                </p>
              </div>
            ) : null}
          </Card>

          {request.status === "aprobada" && request.resulting_booking_id ? (
            <PaymentReportsCard bookingId={request.resulting_booking_id} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
