"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, MessageCircle, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/rentals/ui";
import { monthLabelOf, PROOF_STATUS_META } from "@/lib/rentals/labels";
import { getProofFileUrl, markProofNotApplicable, reopenProof } from "@/lib/actions/rentals-proofs";
import { CopyTextButton } from "./copy-text-button";
import { FileViewer } from "./file-viewer";
import { KindChip, kindLabel } from "./proof-kind-icon";
import { proofRequestMessage } from "./proof-helpers";
import { ProofReviewPanel } from "./proof-review-panel";
import type { ContractProofGridData, ProofGridCell } from "./proof-types";
import { StaffProofUploadDialog } from "./staff-proof-upload-dialog";

/** Lo que se puede hacer con una celda de la grilla del contrato. */
export function ProofCellDialog({ cell, data, onClose }: { cell: ProofGridCell | null; data: ContractProofGridData; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const proof = cell?.proof ?? null;
  const c = data.contract;

  function notApplicable() {
    if (!cell) return;
    startTransition(async () => {
      const res = await markProofNotApplicable(proof?.id ?? { contractId: c.contractId, kind: cell.kind, period: cell.month });
      if (!res.ok) {
        toast.error("No se pudo marcar", { description: res.error });
        return;
      }
      toast.success("Marcado como «no corresponde»");
      onClose();
      router.refresh();
    });
  }

  function askAgain() {
    if (!proof) return;
    startTransition(async () => {
      const res = await reopenProof(proof.id);
      if (!res.ok) {
        toast.error("No se pudo cambiar", { description: res.error });
        return;
      }
      toast.success(res.status === "pendiente" ? "Listo: se vuelve a pedir" : "Listo: volvió a la cola para revisar");
      onClose();
      router.refresh();
    });
  }

  const message = cell
    ? proofRequestMessage({ tenantName: c.tenantName, orgName: data.orgName, kinds: [cell.kind], month: cell.month, address: c.address, portalUrl: c.portalUrl })
    : "";

  return (
    <Dialog open={!!cell} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        {cell && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <KindChip kind={cell.kind} size="sm" />
                {kindLabel(cell.kind)} · {monthLabelOf(cell.month)}
                {proof && proof.status !== "pendiente" && <StatusBadge meta={PROOF_STATUS_META[proof.status]} compact />}
              </DialogTitle>
              <DialogDescription>
                {c.tenantName ?? "Inquilino"} · {c.address}
              </DialogDescription>
            </DialogHeader>

            {proof?.hasFile ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
                <FileViewer cacheKey={`proof:${proof.id}`} mime={proof.fileMime} load={() => getProofFileUrl(proof.id)} minHeightClass="min-h-[50vh]" />
                <ProofReviewPanel key={proof.id} proof={proof} onDecided={onClose} onReopened={onClose} />
              </div>
            ) : proof?.status === "no_corresponde" ? (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
                <p>
                  Se marcó que este mes no corresponde{proof.reviewerName ? ` (${proof.reviewerName})` : ""}.
                  {proof.notes ? ` Nota: ${proof.notes}` : ""}
                </p>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={askAgain}>
                  {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Volver a pedirlo
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {cell.state === "falta"
                    ? "Todavía no llegó. Pedíselo al inquilino (puede subirlo desde su link) o cargalo vos si te lo mandó por otro lado."
                    : "Este mes no se pide, pero lo podés cargar igual."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <StaffProofUploadDialog
                    contractId={c.contractId}
                    currency={c.currency}
                    period={cell.month}
                    kinds={[cell.kind]}
                    tenantName={c.tenantName}
                    onUploaded={onClose}
                  >
                    <Button size="sm" className="gap-1.5">
                      <Upload size={14} /> Subir yo
                    </Button>
                  </StaffProofUploadDialog>
                  {cell.state === "falta" && c.tenantWhatsapp && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                      <a href={`https://wa.me/${c.tenantWhatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                        <MessageCircle size={14} /> Pedir por WhatsApp
                      </a>
                    </Button>
                  )}
                  {cell.state === "falta" && <CopyTextButton text={message} label="Copiar mensaje" toastTitle="Mensaje copiado" />}
                  {cell.state === "falta" && (
                    <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={pending} onClick={notApplicable}>
                      {pending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} No corresponde
                    </Button>
                  )}
                </div>
                {cell.state === "falta" && !c.portalUrl && (
                  <p className="text-[11px] text-muted-foreground">El link del inquilino está apagado: el mensaje le pide que lo mande por WhatsApp.</p>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
