"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Send,
  RefreshCw,
  Loader2,
  Wallet,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  changeSettlementStatus,
  generateSettlement,
  previewRegenerateMergeImpact,
} from "@/lib/actions/settlements";
import { formatMoney } from "@/lib/format";
import {
  SettlementExportButtons,
  type ExportBranding,
} from "./settlement-export-buttons";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SendSettlementDialog } from "./send-settlement-dialog";
import type { StatementInput } from "@/lib/settlements/statement-model";
import type { CashAccount } from "@/lib/types/database";

export function SettlementActions({
  settlement,
  statementInput,
  branding,
  accounts,
  periodLabel,
  canCreate,
  canUpdate,
}: {
  settlement: {
    id: string;
    status: string;
    owner_id: string;
    period_year: number;
    period_month: number;
    currency: string;
    public_token: string;
    owner_email: string | null;
    net_payable: number;
  };
  statementInput: StatementInput;
  branding: ExportBranding;
  accounts: CashAccount[];
  periodLabel: string;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmMerge, setConfirmMerge] = useState<
    Array<{ id: string; currency: string; status: string; net_payable: number }>
  >([]);
  const s = settlement.status;

  function status(next: "revisada" | "enviada") {
    start(async () => {
      try {
        await changeSettlementStatus(settlement.id, next);
        toast.success(`Marcada como ${next}`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  /**
   * Wrapper alrededor de generateSettlement que ejecuta el server action.
   * Lo separamos del click para reutilizarlo desde el AlertDialog de
   * confirmación cuando hay hermanas que se mergerían.
   */
  function doRegenerate() {
    start(async () => {
      try {
        const result = await generateSettlement(
          settlement.owner_id,
          settlement.period_year,
          settlement.period_month,
        );
        if (!result.ok) {
          toast.error("No se pudo regenerar", { description: result.message });
          return;
        }
        toast.success("Liquidación regenerada", {
          description: "Los ajustes manuales se conservaron.",
        });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  /**
   * Pre-flight: pregunta al server si hay liquidaciones hermanas activas en
   * otras monedas. Si las hay, abre el AlertDialog de confirmación. Si no,
   * regenera directo (UX sin fricción para el caso común).
   */
  function regenerate() {
    start(async () => {
      try {
        const impact = await previewRegenerateMergeImpact(settlement.id);
        if (impact.length === 0) {
          doRegenerate();
          return;
        }
        setConfirmMerge(impact);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function copyLink() {
    const url = `${window.location.origin}/liquidacion/${settlement.public_token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado", { description: url }),
      () => toast.error("No se pudo copiar el link"),
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <SettlementExportButtons input={statementInput} branding={branding} />

      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={copyLink}
      >
        <Link2 size={14} /> Link
      </Button>

      {canCreate && s === "borrador" && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={regenerate}
          disabled={pending}
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Regenerar
        </Button>
      )}

      {canUpdate && s === "borrador" && (
        <Button
          size="sm"
          className="gap-2"
          onClick={() => status("revisada")}
          disabled={pending}
        >
          <CheckCircle2 size={14} /> Marcar revisada
        </Button>
      )}

      {canUpdate && s === "revisada" && (
        <Button
          size="sm"
          className="gap-2"
          onClick={() => status("enviada")}
          disabled={pending}
        >
          <CheckCircle2 size={14} /> Marcar enviada
        </Button>
      )}

      {canUpdate && ["borrador", "revisada", "enviada"].includes(s) && (
        <SendSettlementDialog
          settlementId={settlement.id}
          ownerEmail={settlement.owner_email}
          periodLabel={periodLabel}
        >
          <Button variant="outline" size="sm" className="gap-2">
            <Send size={14} /> Enviar
          </Button>
        </SendSettlementDialog>
      )}

      {canUpdate && ["revisada", "enviada"].includes(s) && (
        <RecordPaymentDialog
          settlementId={settlement.id}
          currency={settlement.currency}
          netPayable={settlement.net_payable}
          accounts={accounts}
        >
          <Button
            size="sm"
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            <Wallet size={14} /> Registrar pago
          </Button>
        </RecordPaymentDialog>
      )}

      <AlertDialog
        open={confirmMerge.length > 0}
        onOpenChange={(o) => !o && setConfirmMerge([])}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                size={16}
                className="text-amber-600 dark:text-amber-400"
              />
              Vas a unificar varias liquidaciones del período
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Este propietario tiene{" "}
                  {confirmMerge.length === 1 ? "otra liquidación" : `${confirmMerge.length} liquidaciones`}{" "}
                  activa{confirmMerge.length === 1 ? "" : "s"} en este período
                  en otras monedas. Al regenerar la actual ({settlement.currency})
                  se van a <strong>absorber</strong> y quedar archivadas (status{" "}
                  <em>anulada</em>) para auditoría. Sus reservas e importes se
                  integran acá usando los TC que configures en el detalle.
                </p>
                <ul className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
                  {confirmMerge.map((sib) => (
                    <li
                      key={sib.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {sib.currency}
                      </span>
                      <span className="tabular-nums font-medium">
                        {formatMoney(sib.net_payable, sib.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  No vas a perder datos: las líneas manuales que hayas editado
                  se preservan. Si alguna hermana está pagada, la operación se
                  bloqueará y vas a tener que anularla primero.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmMerge([]);
                doRegenerate();
              }}
            >
              Unificar y regenerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
