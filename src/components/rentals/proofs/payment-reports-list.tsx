"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Eye, Inbox, Loader2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { RegisterPaymentButton } from "@/components/rentals/collections/register-payment-button";
import { formatDate, formatTimeAgo } from "@/lib/format";
import { formatContractNumber, type StatusMeta } from "@/lib/rentals/labels";
import { discardPaymentReport, getPaymentReportFileUrl } from "@/lib/actions/rentals-proofs";
import type { PaymentReportStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { FileViewer } from "./file-viewer";
import type { PaymentReportItem } from "./proof-types";

/**
 * Avisos de pago que mandan los inquilinos desde su link. Un aviso NO es un
 * cobro: se compara con el saldo de la cuenta, se mira el comprobante y se
 * registra el cobro (con su recibo) o se descarta con un motivo.
 */

export const REPORT_STATUS_META: Record<PaymentReportStatus, StatusMeta> = {
  pendiente: { label: "Para revisar", color: "#3b82f6" },
  registrado: { label: "Cobro registrado", color: "#10b981" },
  descartado: { label: "Descartado", color: "#64748b" },
};

const QUICK_DISCARD = ["No entró la plata", "Está repetido", "Era de otro contrato"];

function ReportRow({ r, onView, onDiscard }: { r: PaymentReportItem; onView: (r: PaymentReportItem) => void; onDiscard: (r: PaymentReportItem) => void }) {
  const currency = r.reportCurrency || r.currency;
  const debt = r.debt ?? 0;
  const covers = r.amount != null && debt > 0 && r.amount >= debt - 0.005;
  const pending = r.status === "pendiente";
  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-medium">{r.tenantName ?? "Inquilino"}</p>
          {!pending && <StatusBadge meta={REPORT_STATUS_META[r.status]} compact />}
        </div>
        <Link href={`/dashboard/alquileres/contratos/${r.contractId}`} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <span className="truncate">{r.address}</span>
          <span className="shrink-0 font-mono text-[10px]">{formatContractNumber(r.contractNumber)}</span>
        </Link>
        {r.note && <p className="mt-1.5 line-clamp-2 text-xs italic text-muted-foreground">“{r.note}”</p>}
        {!pending && r.reviewedAt && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {r.reviewerName ? `${r.reviewerName} · ` : ""}
            {formatTimeAgo(r.reviewedAt)}
          </p>
        )}
      </div>
      <div className="flex items-end justify-between gap-4 md:block md:text-right">
        <div>
          <Money amount={r.amount} currency={currency} className="text-lg font-semibold" />
          <p className="text-[11px] text-muted-foreground">
            {r.paidOn ? `pagado el ${formatDate(r.paidOn)}` : "sin fecha"} · avisó {formatTimeAgo(r.createdAt)}
          </p>
        </div>
        {pending && (
          <p className={cn("text-[11px] font-medium", covers ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300")}>
            {debt <= 0 ? "La cuenta no tiene saldo pendiente" : covers ? "Cubre el saldo de la cuenta" : <>Saldo de la cuenta: <Money amount={debt} currency={r.currency} /></>}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
        {r.hasFile ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onView(r)}>
            <Eye size={14} /> Comprobante
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip size={12} /> Sin comprobante
          </span>
        )}
        {pending && (
          <>
            <RegisterPaymentButton contractId={r.contractId} defaultAmount={r.amount} defaultPaidAt={r.paidOn} reportId={r.id} size="sm">
              Registrar cobro
            </RegisterPaymentButton>
            <Button size="icon-sm" variant="ghost" aria-label="Descartar el aviso" title="Descartar el aviso" onClick={() => onDiscard(r)}>
              <Trash2 size={15} className="text-rose-600" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PaymentReportsList({ items }: { items: PaymentReportItem[] }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<PaymentReportItem | null>(null);
  const [discarding, setDiscarding] = useState<PaymentReportItem | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, startTransition] = useTransition();
  const open = items.filter((r) => r.status === "pendiente");
  const resolved = items.filter((r) => r.status !== "pendiente");

  function confirmDiscard() {
    if (!discarding) return;
    if (reason.trim().length < 3) {
      setReasonError("Contá brevemente por qué lo descartás.");
      return;
    }
    const id = discarding.id;
    startTransition(async () => {
      const res = await discardPaymentReport(id, reason.trim());
      if (!res.ok) {
        setReasonError(res.error);
        toast.error("No se pudo descartar", { description: res.error });
        return;
      }
      toast.success("Aviso descartado", { description: "El inquilino lo ve en su link con el motivo." });
      setDiscarding(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {open.length === 0 ? (
        <Card className="items-center gap-3 border-dashed p-8 text-center sm:p-12">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox size={22} />
          </div>
          <div>
            <p className="text-base font-semibold">No hay avisos de pago para revisar</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Cuando un inquilino toca «Ya pagué» en su link, el aviso aparece acá con el comprobante. Lo comparás con el banco y
              registrás el cobro con su recibo.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 divide-y overflow-hidden p-0">
          {open.map((r) => (
            <ReportRow key={r.id} r={r} onView={setViewing} onDiscard={(x) => { setDiscarding(x); setReason(""); setReasonError(null); }} />
          ))}
        </Card>
      )}

      {resolved.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="inline-flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showResolved}
          >
            <ChevronDown size={14} className={cn("transition-transform", showResolved && "rotate-180")} />
            Resueltos en los últimos 30 días ({resolved.length})
          </button>
          {showResolved && (
            <Card className="gap-0 divide-y overflow-hidden p-0 opacity-90">
              {resolved.map((r) => (
                <ReportRow key={r.id} r={r} onView={setViewing} onDiscard={() => undefined} />
              ))}
            </Card>
          )}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Comprobante del aviso</DialogTitle>
            <DialogDescription>
              {viewing ? `${viewing.tenantName ?? "Inquilino"} · ${viewing.address}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <FileViewer
              cacheKey={`report:${viewing.id}`}
              mime={viewing.fileMime}
              load={() => getPaymentReportFileUrl(viewing.id)}
              minHeightClass="min-h-[60vh]"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!discarding} onOpenChange={(o) => !o && !pending && setDiscarding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Descartar el aviso</DialogTitle>
            <DialogDescription>No se registra ningún cobro. El inquilino ve el motivo en su link.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DISCARD.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => { setReason(q); setReasonError(null); }}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", reason === q ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground")}
                >
                  {q}
                </button>
              ))}
            </div>
            <Label htmlFor="discard-reason" className="sr-only">Motivo</Label>
            <Textarea id="discard-reason" rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(null); }} placeholder="Motivo" aria-invalid={!!reasonError} />
            {reasonError && <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{reasonError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={pending} onClick={() => setDiscarding(null)}>Cancelar</Button>
            <Button className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700" disabled={pending} onClick={confirmDiscard}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
