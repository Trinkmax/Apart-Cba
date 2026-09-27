// ─── Helpers para inputs monetarios ─────────────────────────────────────────
// Compartidos por el form de reserva y el diálogo "Completar datos": los dos
// tipean importes y porcentajes como STRING (vacío = "no cargado") y los
// parsean al enviar. Puro, sin React.

import { round2 } from "@/lib/finance/booking-economics";
import { parseAmountInput } from "@/lib/format";

/**
 * Importe o porcentaje tipeado → número. Vacío o ilegible → null. Es
 * parseAmountInput (mismas reglas que Caja y el precio de la unidad): "45.000"
 * son cuarenta y cinco mil, "45,5" y "45.5" cuarenta y cinco y medio.
 */
export function parseMoneyInput(v: string): number | null {
  return parseAmountInput(v);
}

/**
 * Número → string para el input, en centavos como máximo. El redondeo no es
 * cosmético: el parser lee "123.456" como 123456 (miles es-AR), así que un
 * pre-llenado con tres decimales (un % guardado en el JSON de la org, una resta
 * de floats) volvería a leerse mil veces más grande. Con ≤ 2 decimales un
 * String(n) nunca tiene esa forma. La base guarda numeric(14,2) / (5,2): no se
 * pierde nada que se fuera a guardar.
 */
function toInputString(num: number): string {
  return String(round2(num));
}

// Postgres devuelve `numeric` como string ("0.00", "1500.50") via PostgREST,
// aunque las types de la app lo declaren como `number`. Acepta ambos para
// evitar bugs de display tipo "0.00" ocupando un input editable.
export function formatMoneyValue(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "";
  return toInputString(num);
}

// Forma display para inputs *editables*: trata 0 como "no cargado" (igual que
// null) para que el placeholder se muestre y el usuario pueda tipear sin tener
// que borrar el "0" existente. Para read-only o porcentajes con 0 explícito
// (ej. comisión 0%), usar formatMoneyValue.
export function formatMoneyEditable(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "";
  const s = toInputString(num);
  return s === "0" ? "" : s;
}
