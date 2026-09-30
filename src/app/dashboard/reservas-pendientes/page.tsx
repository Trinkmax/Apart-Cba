import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Inbox } from "lucide-react";
import { listBookingRequestsForOrg } from "@/lib/actions/booking-requests";
import { listPaymentReports } from "@/lib/actions/payment-reports";
import {
  listDiscardedChannelRequests,
  listPendingChannelRequests,
} from "@/lib/actions/channel-requests";
import { ChannelRequestCard } from "@/components/channels/channel-request-card";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { WebRequestCard } from "./_components/web-request-card";
import { PaymentReportsList } from "./_components/payment-reports-list";

export const metadata = {
  title: "Solicitudes pendientes · rentOS",
};

type SearchParams = Promise<{ tab?: string | string[] }>;

export default async function ReservasPendientesPage({ searchParams }: { searchParams: SearchParams }) {
  const { role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) redirect("/dashboard");
  const sp = await searchParams;
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const showResolved = tab === "resueltas";

  const canViewChannels = can(role, "channels", "view");
  const canViewMoney = can(role, "payments", "view");
  const canResolvePayments = can(role, "payments", "update");
  const canApprove = can(role, "bookings", "create");
  const canReject = can(role, "bookings", "update");

  const [requests, channelRequests, discardedRequests, paymentReports] = await Promise.all([
    listBookingRequestsForOrg(),
    canViewChannels ? listPendingChannelRequests() : Promise.resolve([]),
    canViewChannels ? listDiscardedChannelRequests() : Promise.resolve([]),
    canViewMoney ? listPaymentReports({ status: "pendiente" }) : Promise.resolve([]),
  ]);

  // Una sola lectura del reloj por request: la etiqueta de vencimiento arranca de acá.
  const serverNow = new Date().getTime();
  // Pendientes: primero la que vence antes (es la que corre peligro).
  const pending = requests
    .filter((r) => r.status === "pendiente")
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
  // Resueltas: la más reciente arriba (la lista ya viene por creación desc).
  const resolved = requests.filter((r) => r.status !== "pendiente");
  const totalPending = pending.length + channelRequests.length;
  const visible = showResolved ? resolved : pending;

  return (
    <div className="page-x page-y max-w-6xl mx-auto space-y-6">
      {/* `channel_reservations` sólo con permiso de canales: su RLS es por
          organización, no por rol, así que suscribirla manda las filas enteras
          (con `guest` y `amounts`) por WebSocket a cualquiera que abra esta
          pantalla — owner_view incluido. `booking_payment_reports` (avisos de
          pago del huésped) sólo con permiso de pagos: su RLS de lectura es de
          admin y recepción (067d), a cualquier otro rol no le emitiría nada. */}
      <LiveRefresh
        tables={[
          "booking_requests",
          "bookings",
          ...(canViewChannels ? ["channel_reservations"] : []),
          ...(canViewMoney ? ["booking_payment_reports"] : []),
        ]}
        label="solicitud"
        labelPlural="solicitudes"
      />
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Solicitudes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fechas pedidas que todavía no son reservas. Se cargan como reserva recién cuando se confirman.
          </p>
        </div>
        {totalPending > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900">
            {totalPending} esperando respuesta
          </Badge>
        ) : null}
      </header>

      <PaymentReportsList reports={paymentReports} canResolve={canResolvePayments} />

      <section className="space-y-3" aria-labelledby="pedidos-web">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="pedidos-web" className="text-lg font-semibold tracking-tight">
              De la web propia
            </h2>
            <span className="text-xs text-muted-foreground">
              Huéspedes esperando tu respuesta · vencen solos a las 48 h
            </span>
          </div>
          <nav aria-label="Pedidos de la web" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            <TabLink href="/dashboard/reservas-pendientes" active={!showResolved}>
              Pendientes
              {pending.length > 0 ? <span className="tabular-nums text-muted-foreground"> · {pending.length}</span> : null}
            </TabLink>
            <TabLink href="/dashboard/reservas-pendientes?tab=resueltas" active={showResolved}>
              Resueltas
            </TabLink>
          </nav>
        </div>

        {visible.length === 0 ? (
          <Card className="p-10 text-center">
            {showResolved ? (
              <Inbox className="mx-auto mb-3 size-10 text-muted-foreground/40" aria-hidden />
            ) : (
              <Clock className="mx-auto mb-3 size-10 text-muted-foreground/40" aria-hidden />
            )}
            <h3 className="font-semibold text-lg">
              {showResolved ? "Todavía no hay pedidos resueltos" : "No hay pedidos esperando respuesta"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showResolved
                ? "Acá quedan los pedidos que confirmaste, rechazaste o vencieron."
                : "Cuando un huésped pide fechas desde la web, aparece acá. Tenés 48 h para responder."}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible.map((r) => (
              <WebRequestCard
                key={r.id}
                request={r}
                serverNow={serverNow}
                canViewMoney={canViewMoney}
                canApprove={canApprove}
                canReject={canReject}
              />
            ))}
          </div>
        )}
      </section>

      {canViewChannels ? (
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight">De las OTAs</h2>
            <span className="text-xs text-muted-foreground">
              Airbnb y Booking · se resuelven solas si la OTA las retira
            </span>
          </div>
          {channelRequests.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              No hay solicitudes de OTA esperando. Las que se caen se descartan solas.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {channelRequests.map((r) => (
                <ChannelRequestCard key={r.id} request={r} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {canViewChannels && discardedRequests.length > 0 ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Solicitudes de OTA descartadas (últimos 30 días) · {discardedRequests.length}
          </summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {discardedRequests.map((r) => (
              <ChannelRequestCard key={r.id} request={r} variant="discarded" />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors sm:min-h-8",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
