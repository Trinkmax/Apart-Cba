"use client";

/**
 * Compuertas para el auto-refresh.
 *
 * `router.refresh()` conserva el estado de los componentes cliente (filtros,
 * scroll, búsqueda), así que un input de filtro NO necesita protección. Lo que
 * sí se rompe es lo que está montado sobre datos que pueden desaparecer: un
 * diálogo de cobro cuya cuota cambió de celda, un formulario a medio llenar, un
 * popover anclado a una fila que ya no existe. Mientras haya uno abierto, las
 * novedades se retienen y se ofrecen con la píldora "N novedades — actualizar".
 *
 * OJO con el selector: Radix monta TODOS sus flotantes —tooltips incluidos—
 * dentro de `[data-radix-popper-content-wrapper]`. Usar ese atributo bloquearía
 * el refresh con sólo pasar el mouse por encima de cualquier ícono, y el PMS
 * está lleno de tooltips. Por eso enumeramos los overlays que de verdad
 * importan, por su `data-slot` de shadcn, y dejamos afuera tooltip y hover-card.
 */

const OVERLAY_SELECTORS = [
  // Dialog y Sheet (Radix les pone role="dialog"), AlertDialog (alertdialog).
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  // Flotantes con interacción real.
  '[data-slot="popover-content"][data-state="open"]',
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]',
].join(",");

export function hasOpenOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(OVERLAY_SELECTORS) !== null;
}

/**
 * Compuerta estándar: no refrescar debajo de un overlay abierto.
 * Combinala con condiciones propias de la pantalla (un drag en curso, etc.).
 */
export function defaultRefreshGate(): boolean {
  return !hasOpenOverlay();
}
