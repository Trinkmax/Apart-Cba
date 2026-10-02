import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getContractProofGrid } from "@/lib/actions/rentals-proofs";
import { ContractProofsGrid } from "./contract-proofs-grid";

/**
 * Pestaña "Expensas y servicios" de la ficha del contrato: grilla meses × tipos
 * (últimos 6 meses + el actual) con el estado de cada comprobante. Tocar una
 * celda abre el comprobante para verlo / validarlo, o para subirlo si falta.
 */
export async function ContractProofsSection({ contractId }: { contractId: string }) {
  const res = await getContractProofGrid(contractId);
  if (!res.ok) {
    return (
      <Card className="flex-row items-center gap-2 p-4 text-sm text-muted-foreground">
        <AlertTriangle size={16} className="shrink-0 text-amber-500" />
        {res.error}
      </Card>
    );
  }
  return <ContractProofsGrid data={res.data} />;
}
