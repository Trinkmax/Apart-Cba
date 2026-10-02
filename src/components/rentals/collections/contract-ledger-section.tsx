import { FileWarning } from "lucide-react";
import { Card } from "@/components/ui/card";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadContractLedger } from "@/lib/rentals/server/collections-queries";
import { LedgerView } from "./ledger-client";

/**
 * Cuenta corriente del contrato (server component): cargos y cobros en orden
 * con saldo corrido, recibos y acciones. Se usa en la pestaña "Cuenta
 * corriente" de la ficha del contrato.
 */
export async function ContractLedgerSection({ contractId }: { contractId: string }) {
  const ctx = await requireRentalsPage();
  const ledger = await loadContractLedger(ctx.admin, ctx.organization.id, contractId, ctx.today);
  if (!ledger) {
    return (
      <Card className="p-6 items-center text-center gap-2 border-dashed">
        <FileWarning size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium">No encontramos la cuenta de este contrato</p>
        <p className="text-xs text-muted-foreground">Puede que se haya borrado o que sea de otra organización.</p>
      </Card>
    );
  }
  return <LedgerView ledger={ledger} />;
}
