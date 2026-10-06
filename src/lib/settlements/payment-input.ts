/**
 * Registrar el pago de una liquidación: lo que comparten la acción
 * (`registerSettlementPayment`, archivo "use server" que no puede exportar
 * constantes) y el diálogo «Registrar pago».
 */

/** Tope de la nota del pago: el diálogo no deja pasarlo y la acción lo valida. */
export const SETTLEMENT_PAYMENT_NOTES_MAX = 300;

/**
 * El error cuando la validación del pago falla. Los mensajes de Zod vienen en
 * inglés, y uno fijo culpaba a los importes también cuando lo que sobraba era
 * la nota: cada reintento daba el mismo error sin señalar el campo, justo en
 * el paso que sigue a «Anular el pago». Se elige por el primer campo que falló.
 */
export function settlementPaymentInvalidMessage(
  path: ReadonlyArray<PropertyKey> | undefined,
): string {
  const field = path?.[0];
  if (field === "notes") {
    return `La nota no puede pasar de ${SETTLEMENT_PAYMENT_NOTES_MAX} caracteres.`;
  }
  if (field === "splits" || field === "amount" || field === "account_id") {
    return "Revisá las cuentas y los importes del pago: cada importe tiene que ser mayor a 0.";
  }
  // settlement_id / paid_at los arma la pantalla, no la persona: si fallan,
  // lo que sirve es recargar.
  return "No se pudieron leer los datos del pago. Recargá la página y probá de nuevo.";
}
