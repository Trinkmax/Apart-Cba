import { formatMoney } from "@/lib/format";
import { settlementNetLabel } from "@/lib/settlements/labels";
import type { StatementModel } from "@/lib/settlements/statement-model";

/**
 * Cuando el propietario cobró él (líneas "Cobrado por el propietario", 077),
 * el neto es sólo lo que falta transferir: no dice cuánto ganó en el mes.
 * Esta franja lo muestra — Ganancia del propietario − Ya cobrado = Neto
 * (Habitana, 28/10/2026). Sin esas líneas no se dibuja: los documentos de
 * siempre quedan iguales.
 */
export function OwnerEarningsStrip({
  totals,
  currency,
  status,
}: {
  totals: StatementModel["totals"];
  currency: string;
  status: string;
}) {
  if (!(totals.ownerCollected > 0)) return null;
  return (
    <div className="grid grid-cols-2 gap-px bg-border border-b">
      <div className="bg-emerald-500/5 px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Ganancia del propietario
        </div>
        <div className="text-lg font-bold mt-0.5 tabular-nums text-emerald-700 dark:text-emerald-400">
          {formatMoney(totals.ownerEarnings, currency)}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Bruto − canal − comisión − gastos
        </div>
      </div>
      <div className="bg-card px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Ya cobrado por el propietario
        </div>
        <div className="text-lg font-semibold mt-0.5 tabular-nums">
          −{formatMoney(totals.ownerCollected, currency)}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Ganancia − lo que ya cobró = {settlementNetLabel(totals.net, status).toLowerCase()}
        </div>
      </div>
    </div>
  );
}
