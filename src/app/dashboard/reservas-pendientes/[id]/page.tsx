import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Calendar,
  Users,
  Mail,
  Phone,
  FileText,
  Clock,
} from "lucide-react";
import { getBookingRequest } from "@/lib/actions/booking-requests";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { BookingRequestActions } from "@/components/bookings/booking-request-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { TimeUntil } from "@/components/marketplace/time-until";

type Params = Promise<{ id: string }>;

export default async function BookingRequestDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const [request, { role }] = await Promise.all([
    getBookingRequest(id),
    getCurrentOrg(),
  ]);
  if (!request) notFound();
  const canViewMoney = can(role, "payments", "view");

  const isPending = request.status === "pendiente";

  return (
    <div className="page-x page-y max-w-4xl mx-auto space-y-5">
      <Link
        href="/dashboard/reservas-pendientes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={14} /> Volver
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Solicitud de reserva
          </h1>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Recibida {new Date(request.created_at).toLocaleString("es-AR")}
        </p>
      </header>

      {isPending ? (
        <Card className="p-4 bg-amber-50 border-amber-200 flex items-center gap-3">
          <Clock size={18} className="text-amber-700" />
          <div className="text-sm text-amber-900 flex-1">
            Esta solicitud expira <TimeUntil isoDeadline={request.expires_at} />. Aprobá o rechazá
            antes para que el huésped no se quede sin respuesta.
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 md:col-span-2 space-y-5">
          <div>
            <h3 className="font-semibold text-neutral-900 mb-2">Unidad solicitada</h3>
            <Link
              href={`/dashboard/unidades/${request.unit?.id ?? request.unit_id}`}
              className="text-base text-rose-600 hover:underline font-medium"
            >
              {request.unit?.marketplace_title ?? request.unit?.name}
            </Link>
            <div className="text-sm text-muted-foreground mt-0.5">
              Código {request.unit?.code ?? "—"}
            </div>
          </div>

          <div className="pt-4 border-t">
            <h3 className="font-semibold text-neutral-900 mb-3">Datos del viaje</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Row icon={<Calendar size={14} />} label="Check-in" value={`${request.check_in_date} · ${request.check_in_time.slice(0, 5)}`} />
              <Row icon={<Calendar size={14} />} label="Check-out" value={`${request.check_out_date} · ${request.check_out_time.slice(0, 5)}`} />
              <Row icon={<Users size={14} />} label="Huéspedes" value={`${request.guests_count}`} />
              <Row icon={<FileText size={14} />} label="Noches" value={`${request.nights}`} />
            </dl>
          </div>

          {request.special_requests ? (
            <div className="pt-4 border-t">
              <h3 className="font-semibold text-neutral-900 mb-2">Mensaje del huésped</h3>
              <p className="text-sm text-neutral-700 whitespace-pre-wrap bg-neutral-50 rounded-lg p-3 border border-neutral-200">
                {request.special_requests}
              </p>
            </div>
          ) : null}

          {request.rejection_reason ? (
            <div className="pt-4 border-t">
              <h3 className="font-semibold text-rose-900 mb-2">Razón del rechazo</h3>
              <p className="text-sm text-rose-700 whitespace-pre-wrap bg-rose-50 rounded-lg p-3 border border-rose-200">
                {request.rejection_reason}
              </p>
            </div>
          ) : null}

          {isPending ? (
            <div className="pt-4 border-t">
              <BookingRequestActions requestId={request.id} />
            </div>
          ) : null}
        </Card>

        <Card className="p-5 h-fit space-y-4">
          <h3 className="font-semibold text-neutral-900">Huésped</h3>
          <div>
            <div className="text-base font-medium">{request.guest_full_name}</div>
            <a
              href={`mailto:${request.guest_email}`}
              className="flex items-center gap-1.5 text-sm text-neutral-700 mt-1 hover:text-neutral-900"
            >
              <Mail size={12} /> {request.guest_email}
            </a>
            {request.guest_phone ? (
              <a
                href={`https://wa.me/${request.guest_phone.replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-neutral-700 mt-1 hover:text-neutral-900"
              >
                <Phone size={12} /> {request.guest_phone}
              </a>
            ) : null}
            {request.guest_document ? (
              <div className="text-xs text-neutral-500 mt-2">
                Doc: {request.guest_document}
              </div>
            ) : null}
          </div>

          {canViewMoney && (
            <div className="pt-4 border-t">
              <h4 className="text-xs font-semibold uppercase text-neutral-500 mb-2">Total</h4>
              <div className="text-2xl font-semibold text-neutral-900">
                {formatMoney(Number(request.total_amount), request.currency)}
              </div>
              {request.cleaning_fee && Number(request.cleaning_fee) > 0 ? (
                <div className="text-xs text-neutral-500 mt-0.5">
                  incluye {formatMoney(Number(request.cleaning_fee), request.currency)} de limpieza
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    aprobada: { label: "Aprobada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    rechazada: { label: "Rechazada", cls: "bg-rose-100 text-rose-800 border-rose-200" },
    expirada: { label: "Expirada", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
    cancelada: { label: "Cancelada", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  };
  const s = map[status] ?? map.pendiente;
  return <Badge className={s.cls}>{s.label}</Badge>;
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </dt>
      <dd className="font-medium text-neutral-900 mt-0.5">{value}</dd>
    </div>
  );
}
