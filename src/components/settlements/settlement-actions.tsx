"use client";

import { useTransition } from "react";
import {
  CheckCircle2,
  Send,
  RefreshCw,
  Loader2,
  Wallet,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  changeSettlementStatus,
  generateSettlement,
} from "@/lib/actions/settlements";
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

  function regenerate() {
    start(async () => {
      try {
        await generateSettlement(
          settlement.owner_id,
          settlement.period_year,
          settlement.period_month,
          settlement.currency,
        );
        toast.success("Liquidación regenerada", {
          description: "Los ajustes manuales se conservaron.",
        });
        router.refresh();
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
    </div>
  );
}
