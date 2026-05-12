import Link from "next/link";
import { Clock, MapPin, Users } from "lucide-react";
import { listBookingRequestsForOrg } from "@/lib/actions/booking-requests";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { TimeUntil } from "@/components/marketplace/time-until";

export const metadata = {
  title: "Solicitudes pendientes · rentOS",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  aprobada: { label: "Aprobada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rechazada: { label: "Rechazada", cls: "bg-rose-100 text-rose-800 border-rose-200" },
  expirada: { label: "Expirada", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  cancelada: { label: "Cancelada", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
};

export default async function ReservasPendientesPage() {
  const requests = await listBookingRequestsForOrg();
  const pendingCount = requests.filter((r) => r.status === "pendiente").length;

  return (
    <div className="page-x page-y max-w-6xl mx-auto space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Solicitudes del marketplace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Huéspedes esperando tu respuesta para unidades sin reserva al toque.
          </p>
        </div>
        {pendingCount > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200">
            {pendingCount} esperando respuesta
          </Badge>
        ) : null}
      </header>

      {requests.length === 0 ? (
        <Card className="p-12 text-center">
          <Clock size={40} className="mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold text-lg">Sin solicitudes pendientes</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Cuando los huéspedes soliciten reservar tus unidades aparecen acá.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {requests.map((r) => {
            const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.pendiente;
            const isPending = r.status === "pendiente";
            return (
              <Link
                key={r.id}
                href={`/dashboard/reservas-pendientes/${r.id}`}
                className="block"
              >
                <Card className="p-4 hover:shadow-md transition-shadow h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-neutral-900 line-clamp-1">
                        {r.unit?.marketplace_title ?? r.unit?.name ?? "Unidad"}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin size={11} />
                        {r.unit?.slug ? `/u/${r.unit.slug}` : `Unidad ${r.unit?.code ?? ""}`}
                      </div>
                    </div>
                    <Badge className={status.cls + " text-xs"}>{status.label}</Badge>
                  </div>

                  <div className="text-sm space-y-1.5">
                    <div className="font-medium text-neutral-900">
                      {r.guest_full_name}
                    </div>
                    <div className="text-muted-foreground text-xs flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} /> {r.guests_count}
                      </span>
                      <span>
                        {r.check_in_date} → {r.check_out_date}
                      </span>
                      <span>{r.nights}n</span>
                    </div>
                    <div className="pt-2 flex items-end justify-between">
                      <div className="font-semibold text-base">
                        {formatMoney(Number(r.total_amount), r.currency)}
                      </div>
                      {isPending ? (
                        <div className="text-xs font-medium flex items-center gap-1 text-amber-700">
                          <Clock size={11} />
                          Expira <TimeUntil isoDeadline={r.expires_at} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
