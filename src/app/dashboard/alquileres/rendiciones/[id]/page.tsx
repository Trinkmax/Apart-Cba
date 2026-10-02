import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, Info, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { getStatement } from "@/lib/actions/rentals-statements";
import { formatDate, formatMoney } from "@/lib/format";
import { StatusBadge } from "@/components/rentals/ui";
import { StatementDocument } from "@/components/rentals/statements/statement-document";
import { StatementActions } from "@/components/rentals/statements/statement-actions";
import type { StatementDetail } from "@/components/rentals/statements/types";

export const metadata = { title: "Rendición" };

function NextStep({ d }: { d: StatementDetail }) {
  const m = d.model;
  if (m.status === "anulada") return null;
  if (m.status === "pagada" && m.totals.net <= 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>
          Cerrada{m.paidAt ? ` el ${formatDate(m.paidAt)}` : ""} sin transferencia, sin movimiento en Caja.
          {m.totals.net < 0 ? ` Los ${formatMoney(Math.abs(m.totals.net), m.currency)} a cargo del propietario se descuentan solos en su próxima rendición.` : ""}
        </span>
      </div>
    );
  }
  if (m.status === "pagada") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>
          Pagada{m.paidAt ? ` el ${formatDate(m.paidAt)}` : ""}. El egreso quedó registrado en Caja; si hubo un error, anulala desde “Más” y generala de nuevo.
        </span>
      </div>
    );
  }
  // Neto cero o negativo: no hay transferencia, pero hay que cerrarla. Lo que el
  // propietario quedó debiendo recién se le descuenta en la próxima rendición
  // cuando esta se cierra; abierta, figura "sin pagar" y no se descuenta nada.
  const noPayout = m.totals.net <= 0;
  const text = noPayout
    ? m.totals.net < 0
      ? `Los gastos superaron lo cobrado: el propietario quedó debiendo ${formatMoney(Math.abs(m.totals.net), m.currency)}. Tocá “Cerrar con saldo a cuenta” para que se le descuente en su próxima rendición; mientras siga ${m.status === "borrador" ? "en borrador" : "emitida"}, no se descuenta.`
      : "El neto da cero: no hay nada para transferir. Cerrala con “Cerrar con saldo a cuenta” para que deje de figurar como sin pagar."
    : m.status === "borrador"
      ? "Revisala y emitila: al emitirla se arma el link para que el propietario la vea desde el celular."
      : m.sentAt
        ? `Se la mandaste${m.sentTo ? ` a ${m.sentTo}` : ""} el ${formatDate(m.sentAt)}. Cuando hagas la transferencia de ${formatMoney(m.totals.net, m.currency)}, registrá el pago.`
        : `Mandásela al propietario (mail o WhatsApp) y, cuando le transfieras ${formatMoney(m.totals.net, m.currency)}, registrá el pago.`;
  const warn = noPayout;
  return (
    <div
      className={
        warn
          ? "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          : "flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      }
    >
      {warn ? <CircleAlert size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

export default async function RendicionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRentalsPage();
  const { id } = await params;
  const res = await getStatement(id);
  if (!res.ok) {
    if (res.error.startsWith("No encontramos")) notFound();
    return (
      <div className="page-x page-y mx-auto max-w-5xl space-y-4">
        <Link href="/dashboard/alquileres/rendiciones" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} /> Rendiciones
        </Link>
        <Card className="p-6 text-sm text-rose-700 dark:text-rose-300">{res.error}</Card>
      </div>
    );
  }
  const d = res.detail;
  const m = d.model;

  return (
    <div className="page-x page-y mx-auto max-w-5xl space-y-4 sm:space-y-5">
      <Link href="/dashboard/alquileres/rendiciones" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} /> Rendiciones
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            Rendición N° {m.number}
            <StatusBadge meta={{ label: m.statusLabel, color: m.statusColor }} />
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
            <Link href={`/dashboard/propietarios/${d.ownerId}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              <UserRound size={13} /> {m.owner.full_name}
            </Link>
            <span className="text-muted-foreground/50"> · </span>
            cobros hasta el {formatDate(m.cutoffDate)}
            <span className="text-muted-foreground/50"> · </span>
            {m.collectedCount} {m.collectedCount === 1 ? "cobro" : "cobros"}
          </p>
        </div>
        <StatementActions
          statementId={m.id}
          model={m}
          branding={d.branding}
          publicUrl={d.publicUrl}
          whatsappText={d.whatsappText}
          ownerWhatsappDigits={d.ownerWhatsappDigits}
          accounts={d.accounts}
          today={ctx.today}
        />
      </div>

      <NextStep d={d} />

      <StatementDocument model={m} brandColor={d.branding.primary_color} orgName={d.orgName} showPayments />
    </div>
  );
}
