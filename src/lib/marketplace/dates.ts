/**
 * Helpers de fecha del marketplace: conversiones ISO (YYYY-MM-DD) ↔ Date
 * usando SIEMPRE componentes locales — nunca toISOString sobre un Date local,
 * que corre el día según el huso del visitante.
 */

/** Date local (00:00) desde un ISO YYYY-MM-DD — sin saltos de timezone. */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** ISO YYYY-MM-DD desde un Date usando componentes locales (lo que ve el usuario). */
export function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Etiqueta corta es-AR para mostrar una fecha elegida (ej. "12 mar"). */
export function formatDayLabel(iso: string): string {
  return isoToDate(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}
