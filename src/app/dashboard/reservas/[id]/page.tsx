import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, User, Phone, Mail, Edit } from "lucide-react";
import { getBooking, listBookings } from "@/lib/actions/bookings";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listAccounts, listMovementsForBooking, listLatestAuditByAccount } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import { BookingActions } from "@/components/bookings/booking-actions";
import { ExtensionHistory } from "@/components/bookings/extension-history";
import { QuickPayCard } from "@/components/bookings/quick-pay-card";
import { BookingPaymentsSection } from "@/components/bookings/booking-payments-section";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatDateLong, formatMoney, formatNights } from "@/lib/format";
import type { Booking, Unit, Guest, BookingPayment } from "@/lib/types/database";

type BookingDetail = Booking & {
  unit: Unit;
  guest: Guest | null;
  payments: BookingPayment[];
};

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [booking, units, accounts, movements, { role }] = await Promise.all([
    getBooking(id),
    listUnitsEnriched(),
    listAccounts(),
    listMovementsForBooking(id),
    getCurrentOrg(),
  ]);
  if (!booking) notFound();
  const b = booking as unknown as BookingDetail;
  const unitBookings = await listBookings({ unitId: b.unit_id });
  const unitsForMovement = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));
  const latestAuditByMovement = await listLatestAuditByAccount(
    "",
    movements.map((m) => m.id)
  );
  const sm = BOOKING_STATUS_META[b.status];
  const src = BOOKING_SOURCE_META[b.source];
  const nights = formatNights(b.check_in_date, b.check_out_date);

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <Link href="/dashboard/reservas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Volver
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Reserva</h1>
            <Badge className="gap-1.5 font-normal" style={{ color: sm.color, backgroundColor: sm.color + "15", borderColor: sm.color + "30" }}>
              <span className="status-dot" style={{ backgroundColor: sm.color }} />
              {sm.label}
            </Badge>
            <Badge variant="outline" style={{ color: src.color, borderColor: src.color + "40" }}>
              {src.label}
            </Badge>
            {b.external_id && (
              <span className="text-xs text-muted-foreground font-mono">#{b.external_id}</span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Creada el {formatDate(b.created_at, "dd 'de' MMM yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <BookingActions booking={b} role={role} />
          <BookingFormDialog booking={b} units={units} accounts={accounts} existingBookings={unitBookings}>
            <Button variant="outline" className="gap-2 flex-1 sm:flex-none"><Edit size={14} /> Editar</Button>
          </BookingFormDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
        <Card className="p-4 sm:p-5 lg:col-span-2 space-y-4 sm:space-y-5">
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Estadía</h2>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Check-in</div>
                <div className="font-semibold mt-1">{formatDateLong(b.check_in_date)}</div>
                <div className="text-xs text-muted-foreground">{b.check_in_time}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Check-out</div>
                <div className="font-semibold mt-1">{formatDateLong(b.check_out_date)}</div>
                <div className="text-xs text-muted-foreground">{b.check_out_time}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <Badge variant="secondary">{nights} {nights === 1 ? "noche" : "noches"}</Badge>
              <Badge variant="secondary">{b.guests_count} {b.guests_count === 1 ? "huésped" : "huéspedes"}</Badge>
            </div>
          </div>

          <Separator />

          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Unidad</h2>
            <Link href={`/dashboard/unidades/${b.unit.id}`} className="mt-2 flex items-start gap-3 hover:bg-accent/30 -m-2 p-2 rounded-lg transition-colors">
              <div className="size-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold font-mono text-xs">
                {b.unit.code.slice(0, 3)}
              </div>
              <div>
                <div className="font-semibold">{b.unit.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin size={11} /> {b.unit.address ?? b.unit.neighborhood ?? "—"}
                </div>
              </div>
            </Link>
          </div>

          <Separator />

          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Huésped</h2>
            {b.guest ? (
              <Link href={`/dashboard/huespedes/${b.guest.id}`} className="mt-2 flex items-start gap-3 hover:bg-accent/30 -m-2 p-2 rounded-lg transition-colors">
                <div className="size-10 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                  <User size={16} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{b.guest.full_name}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {b.guest.phone && <span className="flex items-center gap-1"><Phone size={10} /> {b.guest.phone}</span>}
                    {b.guest.email && <span className="flex items-center gap-1"><Mail size={10} /> {b.guest.email}</span>}
                  </div>
                </div>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Sin huésped asignado</p>
            )}
          </div>

          {b.notes && (
            <>
              <Separator />
              <div>
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Notas</h2>
                <p className="text-sm mt-2 whitespace-pre-wrap">{b.notes}</p>
              </div>
            </>
          )}

          {b.internal_notes && (
            <>
              <Separator />
              <div>
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Notas internas</h2>
                <p className="text-sm mt-2 whitespace-pre-wrap text-amber-700 dark:text-amber-300">{b.internal_notes}</p>
              </div>
            </>
          )}

          <Separator />
          <ExtensionHistory bookingId={b.id} />
        </Card>

        <Card className="p-4 sm:p-5 space-y-4 h-fit">
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Pago</h2>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">{formatMoney(b.total_amount, b.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cobrado</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(b.paid_amount, b.currency)}</span>
              </div>
              {b.total_amount > b.paid_amount && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>Saldo</span>
                  <span className="font-semibold">{formatMoney(b.total_amount - b.paid_amount, b.currency)}</span>
                </div>
              )}

              {/* Pago rápido — visible salvo que la reserva esté cancelada/no_show */}
              <div className="pt-1">
                <QuickPayCard
                  bookingId={b.id}
                  currency={b.currency}
                  totalAmount={Number(b.total_amount)}
                  paidAmount={Number(b.paid_amount)}
                  accounts={accounts}
                  disabled={b.status === "cancelada" || b.status === "no_show"}
                />
              </div>

              {/* Movimientos vinculados a esta reserva (incluye cuotas) */}
              <div className="pt-1">
                <BookingPaymentsSection
                  movements={movements}
                  accounts={accounts}
                  units={unitsForMovement}
                  latestAudit={latestAuditByMovement}
                />
              </div>

              <Separator />
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Comisión Apart Cba</span>
                <span>{formatMoney(b.commission_amount, b.currency)} ({b.commission_pct}%)</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Fee limpieza</span>
                <span>{formatMoney(b.cleaning_fee, b.currency)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Neto al propietario</span>
                <span className="text-emerald-700 dark:text-emerald-300">
                  {formatMoney(
                    Number(b.total_amount) - Number(b.commission_amount ?? 0) - Number(b.cleaning_fee ?? 0),
                    b.currency
                  )}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
