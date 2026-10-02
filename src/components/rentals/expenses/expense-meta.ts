import type {
  RentalExpense,
  RentalExpenseCategory,
  RentalExpenseChargedTo,
  RentalExpensePaidBy,
} from "@/lib/types/database";
import type { StatusMeta } from "@/lib/rentals/labels";

/**
 * Reglas y labels de "Gastos y arreglos" (puro: lo usan el formulario, la
 * lista y las server actions).
 *
 * Qué pasa con un gasto según a cargo de quién va:
 *   - propietario  → se descuenta en su próxima rendición (una sola vez).
 *   - inquilino    → se le suma al próximo cargo mensual (lo hace la
 *                    sincronización del contrato) y lo recupera quien lo pagó.
 *   - inmobiliaria → lo absorbe la inmobiliaria; sólo queda registrado.
 */

export type CajaExpenseCategory = "maintenance" | "utilities" | "tax" | "other";

/** Categoría del egreso en Caja según el tipo de gasto. */
export function cajaCategoryForExpense(category: RentalExpenseCategory): CajaExpenseCategory {
  switch (category) {
    case "reparacion":
    case "mantenimiento":
      return "maintenance";
    case "servicio":
      return "utilities";
    case "impuesto":
      return "tax";
    default:
      return "other";
  }
}

/** En Caja: lo que paga el propietario es "owner"; el resto, de la organización. */
export function cajaBillableFor(chargedTo: RentalExpenseChargedTo): "owner" | "apartcba" {
  return chargedTo === "propietario" ? "owner" : "apartcba";
}

export const PAID_BY_LABEL: Record<RentalExpensePaidBy, string> = {
  inmobiliaria: "La inmobiliaria",
  propietario: "El propietario",
  inquilino: "El inquilino",
  pendiente: "Todavía no se pagó",
};

/**
 * Quién puede haberlo pagado según a cargo de quién va. Se limita a los casos
 * que el sistema liquida bien: un gasto del propietario que pagó el propio
 * propietario no tiene nada que descontar (no se ofrece), y uno del inquilino
 * que ya pagó el inquilino no hay que cobrárselo.
 */
export const PAID_BY_OPTIONS: Record<RentalExpenseChargedTo, RentalExpensePaidBy[]> = {
  propietario: ["inmobiliaria", "pendiente"],
  inquilino: ["inmobiliaria", "propietario", "pendiente"],
  inmobiliaria: ["inmobiliaria", "pendiente"],
};

export function isPaidByAllowed(chargedTo: RentalExpenseChargedTo, paidBy: RentalExpensePaidBy): boolean {
  return PAID_BY_OPTIONS[chargedTo].includes(paidBy);
}

/** Una línea que explica qué va a pasar con el gasto (formulario). */
export function chargedToHint(chargedTo: RentalExpenseChargedTo, paidBy: RentalExpensePaidBy): string {
  if (chargedTo === "propietario") return "Se descuenta de la próxima rendición del propietario (según su % de la propiedad).";
  if (chargedTo === "inquilino") {
    const who =
      paidBy === "propietario" ? " y el propietario lo recupera en su rendición" : paidBy === "inmobiliaria" ? " y la inmobiliaria lo recupera cuando el inquilino paga" : "";
    return `Se le suma al próximo cargo mensual del inquilino${who}.`;
  }
  return "Lo absorbe la inmobiliaria: no se le descuenta ni se le cobra a nadie.";
}

export type ExpenseDisplayState = "a_descontar" | "a_cobrar" | "descontado" | "cobrado" | "inmobiliaria" | "anulado";

export const EXPENSE_STATE_META: Record<ExpenseDisplayState, StatusMeta> = {
  a_descontar: { label: "A descontar", color: "#f59e0b", description: "Entra en la próxima rendición del propietario." },
  a_cobrar: { label: "A cobrar", color: "#3b82f6", description: "Se suma al próximo cargo del inquilino." },
  descontado: { label: "Descontado", color: "#10b981", description: "Ya figura en una rendición." },
  cobrado: { label: "En cargo", color: "#10b981", description: "Ya se le cargó al inquilino." },
  inmobiliaria: { label: "De la inmobiliaria", color: "#64748b", description: "Lo absorbe la inmobiliaria." },
  anulado: { label: "Anulado", color: "#ef4444" },
};

export function expenseDisplayState(e: Pick<RentalExpense, "status" | "charged_to">): ExpenseDisplayState {
  if (e.status === "anulado") return "anulado";
  if (e.charged_to === "inmobiliaria") return "inmobiliaria";
  if (e.charged_to === "propietario") return e.status === "aplicado" ? "descontado" : "a_descontar";
  return e.status === "aplicado" ? "cobrado" : "a_cobrar";
}

/** Cómo se pagó (segunda línea de la fila). */
export function expensePaymentLabel(e: Pick<RentalExpense, "paid_by" | "cash_movement_id">, accountName?: string | null): {
  label: string;
  tone: "in" | "warn" | "muted";
} {
  if (e.cash_movement_id) return { label: accountName ? `Pagado desde Caja · ${accountName}` : "Pagado desde Caja", tone: "in" };
  switch (e.paid_by) {
    case "inmobiliaria":
      return { label: "Lo pagó la inmobiliaria (sin egreso en Caja)", tone: "muted" };
    case "propietario":
      return { label: "Lo pagó el propietario", tone: "muted" };
    case "inquilino":
      return { label: "Lo pagó el inquilino", tone: "muted" };
    default:
      return { label: "Sin pagar", tone: "warn" };
  }
}

/** "0012", "0012 y 0013", "0012, 0013 y 0014". */
export function joinStatementNumbers(numbers: string[]): string {
  const n = numbers.map((x) => `N° ${x}`);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

/**
 * Por qué no se puede editar ni anular (null = se puede).
 * Con varios dueños, el mismo gasto se descuenta en la rendición de cada uno:
 * `statementNumbers` trae todas las que lo siguen descontando, porque hay que
 * anularlas todas antes de tocarlo (si no, a un dueño le queda descontado un
 * importe que ya no existe).
 */
export function expenseLockReason(
  e: Pick<RentalExpense, "status" | "charged_to">,
  refs: { statementNumber?: string | null; statementNumbers?: string[] | null; chargeLabel?: string | null } = {},
): string | null {
  if (e.status === "anulado") return "El gasto está anulado.";
  if (e.status !== "aplicado") return null;
  if (e.charged_to === "propietario") {
    const numbers = refs.statementNumbers?.length ? refs.statementNumbers : refs.statementNumber ? [refs.statementNumber] : [];
    if (numbers.length > 1) {
      return `Ya se descontó en las rendiciones ${joinStatementNumbers(numbers)} (cada dueño, su parte). Si hay que corregirlo, anulá todas esas rendiciones primero.`;
    }
    return numbers.length
      ? `Ya se descontó en la rendición ${joinStatementNumbers(numbers)}. Si hay que corregirlo, anulá esa rendición primero.`
      : "Ya se descontó en una rendición. Si hay que corregirlo, anulá esa rendición primero.";
  }
  return refs.chargeLabel
    ? `Ya se le cargó al inquilino en ${refs.chargeLabel}. Corregilo desde la cuenta corriente del contrato (bonificar o anular el ítem).`
    : "Ya se le cargó al inquilino. Corregilo desde la cuenta corriente del contrato.";
}

/** Puede pagarse desde Caja: no anulado, sin egreso todavía y no lo pagó otra persona. */
export function canPayFromCaja(e: Pick<RentalExpense, "status" | "paid_by" | "cash_movement_id">): boolean {
  return e.status !== "anulado" && !e.cash_movement_id && (e.paid_by === "pendiente" || e.paid_by === "inmobiliaria");
}
