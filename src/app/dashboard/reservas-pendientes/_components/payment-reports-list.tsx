import Link from "next/link";
import { Banknote, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import type { PaymentReportRow } from "@/lib/actions/payment-reports";
import { displayTitle, formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { dateTimeLabel, stayRangeLabel } from "@/lib/marketplace/staff-helpers";
import { ReceiptButton, ResolveReportButtons } from "@/components/bookings/payment-report-actions";

/**
 * "Avisos de pago": huéspedes que dicen que ya transfirieron la seña. Un aviso
 * no es un cobro: el equipo registra el cobro en Caja (desde la reserva) y
 * después marca el aviso.
 */
export function PaymentReportsList({ reports, canResolve }: { reports: PaymentReportRow[]; canResolve: boolean }) {
  if (reports.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="avisos-de-pago">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="avisos-de-pago" className="text-lg font-semibold tracking-tight">
          Avisos de pago
        </h2>
        <span className="text-xs text-muted-foreground">
          {reports.length === 1 ? "1 huésped avisó que transfirió" : `${reports.length} huéspedes avisaron que transfirieron`} · primero
          registrá el cobro en Caja
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {reports.map((r) => (
          <PaymentReportItem key={r.id} report={r} canResolve={canResolve} />
        ))}
      </div>
    </section>
  );
}

function PaymentReportItem({ report: r, canResolve }: { report: PaymentReportRow; canResolve: boolean }) {
  const wa = whatsappLink(r.guest_phone);
  const b = r.booking;
  const sena = b?.deposit_amount != null && b.deposit_amount > 0 ? b.deposit_amount : null;
  return (
    <Card className="flex flex-col gap-3 border-amber-200/70 p-4 dark:border-amber-900/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{r.guest_name ?? "Huésped"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {r.unit ? displayTitle(r.unit.name).title : "Unidad"}
            {b ? ` · ${stayRangeLabel(b.check_in_date, b.check_out_date)}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-flex items-center gap-1 font-semibold tabular-nums">
            <Banknote className="size-4 text-emerald-600" aria-hidden />
            {r.amount != null ? formatMoney(r.amount, r.currency) : "Sin monto"}
          </p>
          <p className="text-xs text-muted-foreground">{dateTimeLabel(r.created_at)}</p>
        </div>
      </div>

      {b ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {sena != null ? `Seña pedida ${formatMoney(sena, b.currency)} · ` : ""}
          Cobrado {formatMoney(b.paid_amount, b.currency)} de {formatMoney(b.total_amount, b.currency)}
        </p>
      ) : null}

      {r.note ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground line-clamp-4">{r.note}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {r.has_receipt ? <ReceiptButton reportId={r.id} /> : <span className="text-xs text-muted-foreground">Sin comprobante.</span>}
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1 px-1 text-sm text-emerald-700 hover:underline underline-offset-2 sm:min-h-8 dark:text-emerald-400"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            {formatPhoneAR(r.guest_phone) ?? r.guest_phone}
          </a>
        ) : null}
      </div>
      {canResolve ? (
        <ResolveReportButtons reportId={r.id} bookingId={r.booking_id} amount={r.amount} currency={r.currency} />
      ) : (
        <Link
          href={`/dashboard/reservas/${r.booking_id}`}
          className="inline-flex min-h-10 items-center text-sm font-medium hover:underline underline-offset-2 sm:min-h-8"
        >
          Ir a la reserva
        </Link>
      )}
    </Card>
  );
}
