import { addDays } from "@/lib/rentals/ymd";
import { EMPTY_RENTALS_NAV_COUNTS, type RentalsNavCounts } from "@/lib/rentals/nav";
import { logRentalsError, type RentalsCtx } from "./access";
import { AUTO_APPLY_HORIZON_DAYS } from "@/lib/rentals/adjustments";

/**
 * Contadores de la barra de pestañas de Tradicionales. Usan las MISMAS reglas
 * que las pantallas a las que llevan, para que el número de la pestaña y el de
 * la página nunca discrepen:
 * - Cobranzas: inquilinos con un cargo vencido sin pagar (= "inquilinos deben"
 *   del Resumen, rentals-dashboard.ts).
 * - Comprobantes: comprobantes en revisión + avisos de pago sin registrar (la
 *   cola de revisión).
 * - Ajustes: a confirmar o sin monto cargado que ya están por regir (dentro
 *   del horizonte de auto-aplicación, como "Pendientes") + aplicados sin avisar
 *   (= el botón "Avisar a todos" de la página de Ajustes, rentals-adjustments.ts).
 *   Los que esperan el índice no cuentan: nadie puede hacer nada todavía.
 *
 * Son un adorno: si una consulta falla, ese contador queda en cero y la barra
 * sigue funcionando.
 */
export async function loadRentalsNavCounts(ctx: RentalsCtx): Promise<RentalsNavCounts> {
  const org = ctx.organization.id;
  const today = ctx.today;
  const head = { count: "exact" as const, head: true as const };
  const adjLite = "id, contract:rental_contracts!inner(status)";
  try {
    const [overdue, proofs, reports, toConfirm, toNotify] = await Promise.all([
      ctx.admin
        .from("rental_charges")
        .select("contract_id, subtotal, paid_amount")
        .eq("organization_id", org)
        .is("voided_at", null)
        .in("status", ["pendiente", "parcial"])
        .lt("due_date", today)
        .limit(5000),
      ctx.admin.from("rental_proofs").select("id", head).eq("organization_id", org).eq("status", "en_revision"),
      ctx.admin.from("rental_payment_reports").select("id", head).eq("organization_id", org).eq("status", "pendiente"),
      ctx.admin
        .from("rental_adjustments")
        .select(adjLite, head)
        .eq("organization_id", org)
        .in("status", ["calculado", "pendiente_manual"])
        .lte("effective_date", addDays(today, AUTO_APPLY_HORIZON_DAYS))
        .eq("contract.status", "vigente"),
      ctx.admin
        .from("rental_adjustments")
        .select(adjLite, head)
        .eq("organization_id", org)
        .eq("status", "aplicado")
        .is("notified_at", null)
        .gte("effective_date", addDays(today, -15))
        .lte("effective_date", addDays(today, 60))
        .eq("contract.status", "vigente"),
    ]);
    for (const [name, res] of [
      ["cargos vencidos", overdue],
      ["comprobantes", proofs],
      ["avisos de pago", reports],
      ["ajustes a confirmar", toConfirm],
      ["ajustes sin aviso", toNotify],
    ] as const) {
      if (res.error) logRentalsError(`navCounts ${name}`, res.error);
    }

    const owing = new Set<string>();
    for (const row of (overdue.data ?? []) as { contract_id: string; subtotal: number | string; paid_amount: number | string }[]) {
      if (Number(row.subtotal) - Number(row.paid_amount) > 0.005) owing.add(row.contract_id);
    }
    return {
      cobranzas: owing.size,
      comprobantes: (proofs.count ?? 0) + (reports.count ?? 0),
      ajustes: (toConfirm.count ?? 0) + (toNotify.count ?? 0),
    };
  } catch (e) {
    logRentalsError("navCounts", e);
    return EMPTY_RENTALS_NAV_COUNTS;
  }
}
