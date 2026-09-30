import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { getBookingPaymentPanel, type BookingSenaSummary, type PaymentReportRow } from "@/lib/actions/payment-reports";
import { dateTimeLabel } from "@/lib/marketplace/staff-helpers";
import { ReceiptButton, ResolveReportButtons } from "./payment-report-actions";

/**
 * "Avisos de pago del huésped" en el detalle de una reserva: lo que el huésped
 * dice que transfirió (con comprobante) y cómo va la seña. Sólo aparece si la
 * reserva salió de la web o tiene avisos; sin permiso de ver pagos, nada.
 */
export async function PaymentReportsCard({ bookingId }: { bookingId: string }) {
  const panel = await getBookingPaymentPanel(bookingId);
  if (!panel) return null;
  const pendingCount = panel.reports.filter((r) => r.status === "pendiente").length;
  const nowMs = new Date().getTime();

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Avisos de pago del huésped</h2>
        {pendingCount > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900">
            {pendingCount === 1 ? "1 aviso por revisar" : `${pendingCount} avisos por revisar`}
          </Badge>
        ) : null}
      </div>

      {panel.sena ? <SenaLine sena={panel.sena} nowMs={nowMs} /> : null}

      {panel.reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          El huésped todavía no avisó que transfirió. Cuando lo haga, lo vas a ver acá con el comprobante.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {panel.reports.map((r) => (
            <ReportItem key={r.id} report={r} canResolve={panel.canResolve} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "Seña pedida $X · Cobrado $Y · Cubierta | Falta $Z, vence …". */
function SenaLine({ sena, nowMs }: { sena: BookingSenaSummary; nowMs: number }) {
  if (sena.amount == null) {
    return <p className="text-sm text-muted-foreground">Sin seña: el huésped paga todo al llegar.</p>;
  }
  const overdue = !sena.covered && sena.dueAt != null && Date.parse(sena.dueAt) < nowMs;
  return (
    <p className="text-sm leading-relaxed">
      <span className="text-muted-foreground">{sena.isEstimate ? "Seña estimada" : "Seña pedida"} </span>
      <span className="font-medium tabular-nums">{formatMoney(sena.amount, sena.currency)}</span>
      <span className="text-muted-foreground"> · Cobrado </span>
      <span className="font-medium tabular-nums">{formatMoney(sena.paid, sena.currency)}</span>
      <span className="text-muted-foreground"> · </span>
      {sena.covered ? (
        <span className="font-medium text-emerald-700 dark:text-emerald-400">Cubierta</span>
      ) : (
        <span className={cn("font-medium", overdue ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
          Falta {formatMoney(sena.missing, sena.currency)}
          {sena.dueAt ? `, ${overdue ? "venció" : "vence"} ${dateTimeLabel(sena.dueAt)}` : ""}
        </span>
      )}
    </p>
  );
}

const STATUS_META: Record<PaymentReportRow["status"], { label: string; cls: string }> = {
  pendiente: {
    label: "Por revisar",
    cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  },
  registrado: {
    label: "Registrado",
    cls: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
  },
  descartado: { label: "Descartado", cls: "bg-muted text-muted-foreground border-border" },
};

function ReportItem({ report, canResolve }: { report: PaymentReportRow; canResolve: boolean }) {
  const meta = STATUS_META[report.status] ?? STATUS_META.pendiente;
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge className={meta.cls}>{meta.label}</Badge>
        <span className="font-semibold tabular-nums">
          {report.amount != null ? formatMoney(report.amount, report.currency) : "Sin monto"}
        </span>
        <span className="text-xs text-muted-foreground">Avisó el {dateTimeLabel(report.created_at)}</span>
      </div>
      {report.note ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{report.note}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {report.has_receipt ? <ReceiptButton reportId={report.id} /> : (
          <span className="text-xs text-muted-foreground">Sin comprobante adjunto.</span>
        )}
        {report.status === "pendiente" && canResolve ? (
          <ResolveReportButtons
            reportId={report.id}
            bookingId={report.booking_id}
            amount={report.amount}
            currency={report.currency}
            showBookingLink={false}
          />
        ) : null}
      </div>
    </li>
  );
}
