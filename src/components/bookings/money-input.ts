// ─── Helpers para inputs monetarios ─────────────────────────────────────────
// Compartidos por el form de reserva y el diálogo "Completar datos": los dos
// tipean importes y porcentajes como STRING (vacío = "no cargado") y los
// parsean al enviar. Puro, sin React.

/** Acepta tanto `.` como `,` como separador decimal. Vacío → null. */
export function parseMoneyInput(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  // Si tenía un solo punto (input internacional), revertir el primer reemplazo.
  // Heurística: si normalized no parsea, probamos el original con punto.
  const direct = Number(trimmed.replace(",", "."));
  const n = Number.isFinite(direct) ? direct : Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// Postgres devuelve `numeric` como string ("0.00", "1500.50") via PostgREST,
// aunque las types de la app lo declaren como `number`. Acepta ambos para
// evitar bugs de display tipo "0.00" ocupando un input editable.
export function formatMoneyValue(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "";
  return String(num);
}

// Forma display para inputs *editables*: trata 0 como "no cargado" (igual que
// null) para que el placeholder se muestre y el usuario pueda tipear sin tener
// que borrar el "0" existente. Para read-only o porcentajes con 0 explícito
// (ej. comisión 0%), usar formatMoneyValue.
export function formatMoneyEditable(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num === 0) return "";
  return String(num);
}
