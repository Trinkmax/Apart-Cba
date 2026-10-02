import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Qué pantallas refrescar después de escribir algo del módulo Alquileres.
 * No hay invalidación global: si un dato se ve en varias rutas, se revalidan
 * todas (CLAUDE.md). Cada action llama esto con lo que tocó.
 */
export function revalidateRentals(opts: {
  contractId?: string | null;
  propertyId?: string | null;
  personId?: string | null;
  statementId?: string | null;
  ownerId?: string | null;
  /** Se movió plata en Caja (cobro, pago de rendición, gasto). */
  caja?: boolean;
} = {}): void {
  revalidatePath("/dashboard/alquileres");
  revalidatePath("/dashboard/alquileres/contratos");
  revalidatePath("/dashboard/alquileres/cobranzas");
  revalidatePath("/dashboard/alquileres/comprobantes");
  revalidatePath("/dashboard/alquileres/ajustes");
  revalidatePath("/dashboard/alquileres/rendiciones");
  revalidatePath("/dashboard/alquileres/propiedades");
  revalidatePath("/dashboard/alquileres/personas");
  if (opts.contractId) revalidatePath(`/dashboard/alquileres/contratos/${opts.contractId}`);
  if (opts.propertyId) revalidatePath(`/dashboard/alquileres/propiedades/${opts.propertyId}`);
  if (opts.personId) revalidatePath(`/dashboard/alquileres/personas/${opts.personId}`);
  if (opts.statementId) revalidatePath(`/dashboard/alquileres/rendiciones/${opts.statementId}`);
  if (opts.ownerId) revalidatePath(`/dashboard/propietarios/${opts.ownerId}`);
  if (opts.caja) {
    revalidatePath("/dashboard/caja");
    revalidatePath("/dashboard/caja/[accountId]", "page");
    revalidatePath("/dashboard");
  }
}
