"use client";

import { useState, type ComponentProps } from "react";
import { MovementsList } from "./movements-list";
import { MovementDetailSheet } from "./movement-detail-sheet";
import type { CashAccount, Unit } from "@/lib/types/database";

/**
 * Lista de "Movimientos recientes" del dashboard de Caja, clickeable:
 * abre el mismo MovementDetailSheet (Detalle/Editar/Eliminar) que la
 * página de cuenta. Reusa los componentes existentes.
 */
export function RecentMovementsPanel({
  movements,
  accounts,
  units,
}: {
  movements: ComponentProps<typeof MovementsList>["movements"];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <MovementsList movements={movements} onSelect={setOpenId} />
      <MovementDetailSheet
        open={openId !== null}
        movementId={openId}
        accounts={accounts}
        units={units}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
