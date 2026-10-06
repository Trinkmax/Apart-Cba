import type { KeyboardEvent } from "react";

const FIELDS = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [role="combobox"]:not([disabled])';
const NOT_TEXT = new Set(["submit", "button", "reset", "image", "file"]);

const isVisible = (el: HTMLElement) => el.getClientRects().length > 0;

/**
 * `onKeyDown` del <form> de la propiedad: Enter (o "Ir" en el teclado del
 * celular) en un campo pasa al campo siguiente; en el último, al botón de
 * guardar. No guarda: un Enter de más en el % o en la calle guardaba la
 * propiedad entera y creaba al propietario nuevo con la mitad de los datos.
 * El único que guarda es «Guardar propiedad». Un campo de una sección plegada
 * no cuenta (no se ve).
 */
export function enterMovesFocus(e: KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.defaultPrevented) return;
  const form = e.currentTarget;
  const target = e.target as HTMLElement;
  // Sólo campos de una línea de ESTE formulario: el buscador del propietario vive en un
  // portal y su Enter (elegir) también llega acá por React.
  if (target.tagName !== "INPUT" || !form.contains(target) || NOT_TEXT.has((target as HTMLInputElement).type)) return;
  e.preventDefault();
  const fields = Array.from(form.querySelectorAll<HTMLElement>(FIELDS)).filter(isVisible);
  const index = fields.indexOf(target);
  const next = index >= 0 ? fields[index + 1] : undefined;
  if (next) next.focus();
  else form.querySelector<HTMLElement>('button[type="submit"]:not([disabled])')?.focus();
}
